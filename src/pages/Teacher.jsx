import React, { useEffect, useState, useRef } from 'react';
import JSZip from 'jszip';
import io from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://13.61.180.133:3000'; // Change to your server URL

const Teacher = () => {
    const [socket, setSocket] = useState(null);
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([]);
    const [room, setRoom] = useState('');
    const [studentList, setStudentList] = useState([]);
    const [studentStreams, setStudentStreams] = useState({});
    const studentStreamsRef = useRef({});
    const [recordings, setRecordings] = useState({});
    const recordingsRef = useRef({});
    const [isRecordingAll, setIsRecordingAll] = useState(false);
    const [videoQuality, setVideoQuality] = useState('720');
    const [fullScreenStudent, setFullScreenStudent] = useState(null);
    const fullScreenVideoRef = useRef(null);
    const bitrateMap = {
        '144': 150_000,
        '360': 800_000,
        '480': 1_200_000,
        '720': 2_500_000,
        '1080': 5_000_000
    };

    // Start recording all student streams
    const startRecordingAll = () => {
        const bitsPerSecond = bitrateMap[videoQuality] || bitrateMap['720'];
        Object.keys(studentStreamsRef.current).forEach((studentId) => {
            const stream = studentStreamsRef.current[studentId]?.stream;
            if (!stream) return;
            if (recordingsRef.current[studentId]?.isRecording) return;
            const chunks = [];
            const recorder = new window.MediaRecorder(stream, {
                mimeType: 'video/webm',
                videoBitsPerSecond: bitsPerSecond
            });
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                recordingsRef.current[studentId] = {
                    ...recordingsRef.current[studentId],
                    url,
                    blob,
                    isRecording: false,
                };
                setRecordings({ ...recordingsRef.current });
            };
            recorder.start();
            recordingsRef.current[studentId] = {
                recorder,
                chunks,
                url: null,
                blob: null,
                isRecording: true,
                regid: studentId,
            };
        });
        setRecordings({ ...recordingsRef.current });
        setIsRecordingAll(true);
    };

    // Stop recording all
    const stopRecordingAll = () => {
        Object.values(recordingsRef.current).forEach((rec) => {
            if (rec && rec.recorder && rec.isRecording) {
                rec.recorder.stop();
            }
        });
        setIsRecordingAll(false);
    };

    // Download all as zip
    const downloadAllAsZip = async () => {
        const zip = new JSZip();
        for (const [studentId, rec] of Object.entries(recordingsRef.current)) {
            if (rec && rec.blob) {
                zip.file(`${studentMapRef.current[studentId]}.webm`, rec.blob);
            }
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        a.href = URL.createObjectURL(content);
        a.download = `${today}.zip`;
        a.click();
    };
    const studentMapRef = useRef({});

    // PeerConnection manager
    const PeerConnection = (function () {
        const connections = new Map();
        const createPeerConnection = (sock, studentId) => {
            const config = {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            };
            const pc = new RTCPeerConnection(config);
            pc.ontrack = (event) => {
                studentStreamsRef.current[studentId] = {
                    ...(studentStreamsRef.current[studentId] || {}),
                    stream: event.streams[0],
                };
                setStudentStreams({ ...studentStreamsRef.current });
            };
            pc.onicecandidate = (event) => {
                if (event.candidate && sock) {
                    sock.emit("iceCandidate", { to: studentId, candidate: event.candidate });
                }
            };
            connections.set(studentId, pc);
            studentStreamsRef.current[studentId] = {
                ...(studentStreamsRef.current[studentId] || {}),
                pc,
            };
            return pc;
        };
        return {
            createNew: (sock, studentId) => {
                if (connections.has(studentId)) {
                    return connections.get(studentId);
                }
                return createPeerConnection(sock, studentId);
            },
            getById: (studentId) => connections.get(studentId)
        };
    })();

    const createRoom = () => {
        if (socket) {
            const newRoom = Math.random().toString(36).substring(2, 15);
            setRoom(newRoom);
            socket.emit('createRoom', { roomName: newRoom, allowedStudents: studentList });
            console.log(`Room created: ${newRoom}`);
        }
    };

    useEffect(() => {
        const msocket = io(SOCKET_SERVER_URL);
        setSocket(msocket);

        msocket.on('connect', () => {
            console.log('Connected to socket server as teacher', msocket.id);
        });

        msocket.on('message', (msg) => {
            setMessages((prev) => [...prev, msg]);
        });

        msocket.on('videoOffer', async ({ from, offer, regId }) => {
            console.log("Received video offer from:", from);
            studentMapRef.current[from] = regId;
            try {
                const pc = PeerConnection.createNew(msocket, from);
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                msocket.emit('videoAnswer', { to: from, answer });
                console.log("Sent video answer to:", from);
            } catch (err) {
                console.error("Error handling video offer:", err);
            }
        });

        msocket.on('iceCandidate', async ({ from, candidate }) => {
            try {
                const pc = PeerConnection.getById(from);
                if (pc) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (err) {
                console.error("Error adding ICE candidate:", err);
            }
        });

        return () => {
            msocket.disconnect();
        };
    }, []);

    const sendMessage = () => {
        if (socket && message.trim()) {
            socket.emit('message', { sender: 'teacher', text: message });
            setMessage('');
        }
    };

    useEffect(() => {
        Object.entries(studentStreams).forEach(([studentId, { stream }]) => {
            const video = document.getElementById(`video-${studentId}`);
            if (video && stream && video.srcObject !== stream) {
                video.srcObject = stream;
            }
        });
    }, [studentStreams]);

    useEffect(() => {
        recordingsRef.current = recordings;
    }, [recordings]);

    // Handle fullscreen video stream
    useEffect(() => {
        if (fullScreenStudent && studentStreams[fullScreenStudent]?.stream && fullScreenVideoRef.current) {
            fullScreenVideoRef.current.srcObject = studentStreams[fullScreenStudent].stream;
        }
    }, [fullScreenStudent, studentStreams]);

    const handleStudentClick = (studentId) => {
        setFullScreenStudent(studentId);
    };

    const closeFullScreen = () => {
        setFullScreenStudent(null);
    };

    return (
        <div style={{ 
            backgroundColor: '#f5f5f5', 
            minHeight: '100vh',
            padding: '20px'
        }}>
            {/* Header */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '30px',
                paddingBottom: '15px',
                borderBottom: '1px solid #e0e0e0'
            }}>
                <h1 style={{ color: '#333', margin: 0 }}>EduCode</h1>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span style={{ fontWeight: 'bold' }}>Welcome, Teacher</span>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ 
                display: 'grid',
                gridTemplateColumns: '300px 1fr',
                gap: '20px'
            }}>
                {/* Left Sidebar */}
                <div style={{ 
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '20px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    <h3 style={{ 
                        color: '#333',
                        borderBottom: '1px solid #eee',
                        paddingBottom: '10px',
                        marginBottom: '20px'
                    }}>Students ({studentList.length})</h3>
                    
                    <div style={{ marginBottom: '20px' }}>
                        <input 
                            type="text" 
                            placeholder="Enter student reg id" 
                            style={{ 
                                width: '100%', 
                                padding: '10px',
                                marginBottom: '10px',
                                border: '1px solid #ddd',
                                borderRadius: '4px'
                            }}
                        />
                        <button 
                            onClick={() => {
                                const regId = document.querySelector('input[placeholder="Enter student reg id"]').value;
                                if (regId.trim()) {
                                    setStudentList((prev) => [...prev, regId]);
                                }
                            }}
                            style={{ 
                                width: '100%', 
                                padding: '10px',
                                backgroundColor: '#4CAF50',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            Add Student
                        </button>
                    </div>

                    <button 
                        onClick={createRoom}
                        style={{ 
                            width: '100%', 
                            padding: '10px',
                            backgroundColor: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            marginBottom: '20px',
                            cursor: 'pointer'
                        }}
                    >
                        Create Room
                    </button>

                    <div>
                        <h4 style={{ 
                            color: '#555',
                            marginBottom: '15px'
                        }}>Connected Students</h4>
                        <div style={{ 
                            maxHeight: '400px',
                            overflowY: 'auto'
                        }}>
                            {Object.entries(studentStreams).map(([studentId]) => (
                                <div
                                    key={studentId} 
                                    onClick={() => handleStudentClick(studentId)}
                                    style={{
                                        padding: '12px',
                                        marginBottom: '8px',
                                        backgroundColor: fullScreenStudent === studentId ? '#f0f7ff' : 'white',
                                        border: '1px solid #eee',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        transition: 'background-color 0.2s'
                                    }}
                                >
                                    <span style={{ 
                                        color: '#2196F3',
                                        fontSize: '18px'
                                    }}>🎥</span>
                                    <span>{studentMapRef.current[studentId] || studentId}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Content */}
                <div style={{ 
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '20px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    <h2 style={{ 
                        color: '#333',
                        marginBottom: '20px'
                    }}>Classroom: {room || 'Not created'}</h2>

                    {/* Full Screen Video */}
                    {fullScreenStudent && studentStreams[fullScreenStudent] && (
                        <div style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.9)',
                            zIndex: 1000,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <div style={{ 
                                position: 'absolute', 
                                top: '20px', 
                                right: '20px', 
                                zIndex: 1001 
                            }}>
                                <button 
                                    onClick={closeFullScreen}
                                    style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#ff4444',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Close
                                </button>
                            </div>
                            <video 
                                ref={fullScreenVideoRef}
                                autoPlay 
                                playsInline 
                                style={{ 
                                    maxWidth: '90%',
                                    maxHeight: '90%',
                                    objectFit: 'contain'
                                }}
                            />
                            <div style={{ 
                                color: 'white', 
                                marginTop: '16px',
                                fontSize: '1.2rem'
                            }}>
                                {studentMapRef.current[fullScreenStudent] || fullScreenStudent}
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div style={{ 
                        backgroundColor: '#f8f8f8',
                        padding: '20px',
                        borderRadius: '8px',
                        marginBottom: '30px'
                    }}>
                        <div style={{ 
                            display: 'flex',
                            gap: '10px',
                            marginBottom: '15px'
                        }}>
                            <input
                                type="text"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder="Type a message to students..."
                                style={{ 
                                    flex: 1,
                                    padding: '10px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px'
                                }}
                            />
                            <button 
                                onClick={sendMessage}
                                style={{ 
                                    padding: '10px 20px',
                                    backgroundColor: '#2196F3',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Send
                            </button>
                        </div>

                        <div style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '15px',
                            marginBottom: '15px'
                        }}>
                            <div>
                                <label style={{ 
                                    marginRight: '8px',
                                    fontWeight: '500'
                                }}>
                                    Video Quality:
                                </label>
                                <select 
                                    value={videoQuality} 
                                    onChange={e => setVideoQuality(e.target.value)} 
                                    style={{ 
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                >
                                    <option value="144">144p (Very Low)</option>
                                    <option value="360">360p</option>
                                    <option value="480">480p</option>
                                    <option value="720">720p</option>
                                    <option value="1080">1080p</option>
                                </select>
                            </div>

                            <div style={{ 
                                display: 'flex',
                                gap: '10px'
                            }}>
                                {!isRecordingAll && (
                                    <button 
                                        onClick={startRecordingAll}
                                        style={{ 
                                            padding: '10px 20px',
                                            backgroundColor: '#ff4444',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Start Recording All
                                    </button>
                                )}
                                {isRecordingAll && (
                                    <button 
                                        onClick={stopRecordingAll}
                                        style={{ 
                                            padding: '10px 20px',
                                            backgroundColor: '#444',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Stop Recording All
                                    </button>
                                )}
                                <button 
                                    onClick={downloadAllAsZip}
                                    style={{ 
                                        padding: '10px 20px',
                                        backgroundColor: '#4CAF50',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Download All
                                </button>
                            </div>
                        </div>

                        <div style={{ 
                            color: '#555',
                            fontSize: '14px'
                        }}>
                            {(() => {
                                const n = Object.keys(studentStreams).length;
                                const bitrate = bitrateMap[videoQuality] || bitrateMap['720'];
                                const seconds = 2 * 60 * 60;
                                const totalBytes = n * bitrate * seconds / 8;
                                const totalGB = totalBytes / (1024 ** 3);
                                return `Estimated ZIP size for 2hr recording of ${n} student${n === 1 ? '' : 's'} at ${videoQuality}p: ${totalGB.toFixed(2)} GB`;
                            })()}
                        </div>
                    </div>

                    {/* Messages */}
                    <div style={{ marginBottom: '30px' }}>
                        <h4 style={{ 
                            color: '#333',
                            marginBottom: '15px'
                        }}>Messages:</h4>
                        <div style={{ 
                            height: '150px', 
                            overflowY: 'auto', 
                            border: '1px solid #ddd',
                            padding: '15px',
                            backgroundColor: 'white',
                            borderRadius: '6px'
                        }}>
                            {messages.map((msg, idx) => (
                                <div key={idx} style={{ 
                                    marginBottom: '8px',
                                    paddingBottom: '8px',
                                    borderBottom: idx < messages.length - 1 ? '1px solid #eee' : 'none'
                                }}>
                                    <strong style={{ color: '#2196F3' }}>{msg.sender}: </strong>
                                    <span>{msg.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Video Grid */}
                    <div>
                        <h4 style={{ 
                            color: '#333',
                            marginBottom: '15px'
                        }}>Student Streams</h4>
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                            gap: '20px'
                        }}>
                            {Object.entries(studentStreams).map(([studentId]) => (
                                <div 
                                    key={studentId} 
                                    style={{ 
                                        border: '1px solid #eee', 
                                        borderRadius: '8px',
                                        padding: '15px',
                                        backgroundColor: 'white',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                    }}
                                >
                                    <div style={{ 
                                        fontWeight: 'bold', 
                                        marginBottom: '10px',
                                        color: '#333'
                                    }}>
                                        {studentMapRef.current[studentId] || studentId}
                                    </div>
                                    <video 
                                        id={`video-${studentId}`} 
                                        width="100%" 
                                        height="auto" 
                                        autoPlay 
                                        playsInline 
                                        style={{ 
                                            borderRadius: '6px',
                                            backgroundColor: '#000'
                                        }}
                                    />
                                    <button 
                                        onClick={() => handleStudentClick(studentId)}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            marginTop: '10px',
                                            backgroundColor: '#2196F3',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.2s'
                                        }}
                                        onMouseOver={(e) => e.target.style.backgroundColor = '#0d8bf2'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = '#2196F3'}
                                    >
                                        View Full Screen
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Teacher;