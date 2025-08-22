
// TeacherDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Room } from 'livekit-client';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const LIVEKIT_URL = "wss://educode-190pkw3r.livekit.cloud";
const BACKEND_URL = "https://edu-code-one.vercel.app";

// Modern teaching-themed color palette
const COLORS = {
  primary: '#4A6CF7',      // EduCode blue
  secondary: '#10B981',    // Success green
  accent: '#8B5CF6',       // Purple accent
  dark: '#1E1E2E',         // Background
  darker: '#151522',       // Sidebar
  card: '#252536',         // Card background
  text: '#E2E2E6',         // Primary text
  textSecondary: '#A0A0B0', // Secondary text
  warning: '#F59E0B',      // Warning/orange
  error: '#EF4444',        // Error/red
  loading: '#4A6CF7'       // Loading indicator
};

export default function TeacherDashboard() {
  const [teacherId, setTeacherId] = useState('');
  const [students, setStudents] = useState([]);
  const [connectedStudents, setConnectedStudents] = useState([]);
  const [status, setStatus] = useState('Enter your teacher ID');
  const [examStarted, setExamStarted] = useState(false);
  const [room, setRoom] = useState(null);
  const [streams, setStreams] = useState([]);
  const [recording, setRecording] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isLoading, setIsLoading] = useState({
    fetchStudents: false,
    connectRoom: false,
    generateZip: false
  });
  
  const mediaRecorders = useRef({});
  const recordedChunks = useRef({});

  const fetchStudentList = async () => {
    if (!teacherId) return;
    
    setIsLoading(prev => ({ ...prev, fetchStudents: true }));
    setStatus('Fetching student list...');
    
    try {
      const response = await fetch(`${BACKEND_URL}/teachers/getStudentList/${teacherId}`);
      const data = await response.json();
      setStudents(data.studentList);
      setStatus(`Found ${data.studentList.length} students`);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStatus('Error fetching students');
    } finally {
      setIsLoading(prev => ({ ...prev, fetchStudents: false }));
    }
  };

  const startExam = async () => {
    setIsLoading(prev => ({ ...prev, connectRoom: true }));
    setStatus('Connecting to exam room...');
    
    try {
      const res = await fetch(`${BACKEND_URL}/createToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ID: teacherId,
          studentList: students
        })
      });
      const data = await res.json();
      const token = data.token;

      const newRoom = new Room();
      await newRoom.connect(LIVEKIT_URL, token);
      setRoom(newRoom);
      setStatus("Exam room connected");
      setExamStarted(true);

      newRoom.on('participantConnected', (participant) => {
        setConnectedStudents(prev => [...prev, participant.identity]);
      });

      newRoom.on('trackSubscribed', (track, publication, participant) => {
        if (track.kind === "video") {
          setStreams(prev => {
            const filtered = prev.filter(s => s.id !== participant.identity);
            return [...filtered, { 
              track, 
              id: participant.identity,
              name: students.find(s => s === participant.identity) || participant.identity
            }];
          });
        }
      });

      newRoom.on('participantDisconnected', (participant) => {
        setConnectedStudents(prev => prev.filter(id => id !== participant.identity));
        setStreams(prev => prev.filter(s => s.id !== participant.identity));
        if (selectedStudent === participant.identity) {
          setSelectedStudent(null);
        }
      });

    } catch (e) {
      console.error("Error connecting teacher:", e);
      setStatus("Error: " + e.message);
    } finally {
      setIsLoading(prev => ({ ...prev, connectRoom: false }));
    }
  };

  const startRecording = () => {
    setRecording(true);
    recordedChunks.current = {};
    
    streams.forEach(stream => {
      const mediaStream = new MediaStream();
      mediaStream.addTrack(stream.track.mediaStreamTrack);
      
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'video/webm'
      });
      
      recordedChunks.current[stream.id] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.current[stream.id].push(event.data);
        }
      };
      
      mediaRecorder.start(1000);
      mediaRecorders.current[stream.id] = mediaRecorder;
    });
  };

  const stopRecording = async () => {
    setIsLoading(prev => ({ ...prev, generateZip: true }));
    setRecording(false);
    
    try {
      Object.values(mediaRecorders.current).forEach(recorder => {
        recorder.stop();
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const zip = new JSZip();
      const dateStr = new Date().toISOString().split('T')[0];
      
      for (const [studentId, chunks] of Object.entries(recordedChunks.current)) {
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: 'video/webm' });
          zip.file(`${studentId}.webm`, blob);
        }
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `exam-recordings-${dateStr}.zip`);
      setStatus('Recordings downloaded successfully!');
    } catch (error) {
      console.error('Error generating zip:', error);
      setStatus('Error generating recordings');
    } finally {
      setIsLoading(prev => ({ ...prev, generateZip: false }));
    }
  };

  const endExam = async () => {
    if (room) {
      await room.disconnect();
    }
    setExamStarted(false);
    setConnectedStudents([]);
    setStreams([]);
    setSelectedStudent(null);
    setStatus('Exam ended');
  };

  const handleStudentSelect = (studentId) => {
    setSelectedStudent(selectedStudent === studentId ? null : studentId);
  };

  const LoadingSpinner = ({ size = 20, color = COLORS.loading }) => (
    <div 
      style={{ 
        width: size, 
        height: size, 
        border: `2px solid ${color}33`,
        borderTop: `2px solid ${color}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        display: 'inline-block'
      }} 
    />
  );

  // Add keyframes to document head if not already present
  useEffect(() => {
    if (!document.getElementById('spin-animation')) {
      const style = document.createElement('style');
      style.id = 'spin-animation';
      style.innerHTML = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div style={{ 
      overflowY: 'scroll',
      display: 'flex', 
      minHeight: '100vh',
      backgroundColor: COLORS.dark,
      color: COLORS.text,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }}>
      {/* Sidebar */}
      <div style={{ 
        overflowY: 'scroll',
        width: '280px', 
        background: COLORS.darker, 
        padding: '24px',
        borderRight: `1px solid ${COLORS.card}`,
        height: '100vh',
        position: 'sticky',
        top: 0
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          marginBottom: '32px',
          gap: '12px'
        }}>
          <div style={{ 
            background: COLORS.primary, 
            width: '36px', 
            height: '36px', 
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold'
          }}>
            <img src="/EduCode.png" alt="EduCode Logo" width={40} height={40} />
          </div>
          <h1 style={{ 
            fontSize: '24px', 
            fontWeight: 'bold',
            background: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.accent} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>EduCode</h1>
        </div>
        
        <div style={{ 
          background: COLORS.card, 
          borderRadius: '16px', 
          padding: '20px',
          marginBottom: '24px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
          <h2 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span role="img" aria-label="exam">📝</span> Exam Control
          </h2>
          
          {!examStarted ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px', 
                  fontSize: '14px',
                  color: COLORS.textSecondary
                }}>Teacher ID:</label>
                <input 
                  type="text" 
                  value={teacherId} 
                  onChange={(e) => setTeacherId(e.target.value)} 
                  placeholder="Enter your ID"
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    borderRadius: '10px',
                    border: `1px solid ${COLORS.card}`,
                    backgroundColor: COLORS.darker,
                    color: COLORS.text,
                    fontSize: '14px',
                    transition: 'border 0.2s'
                  }}
                  onFocus={e => e.target.style.borderColor = COLORS.primary}
                  onBlur={e => e.target.style.borderColor = COLORS.card}
                />
              </div>
              
              <button 
                onClick={fetchStudentList}
                disabled={isLoading.fetchStudents || !teacherId}
                style={{ 
                  width: '100%', 
                  padding: '12px', 
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: COLORS.primary,
                  color: 'white',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '16px',
                  opacity: isLoading.fetchStudents ? 0.8 : 1,
                  transition: 'opacity 0.2s'
                }}
              >
                {isLoading.fetchStudents ? (
                  <>
                    <LoadingSpinner size={16} /> Fetching Students...
                  </>
                ) : (
                  'Fetch Student List'
                )}
              </button>
              
              {students.length > 0 && (
                <div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <h3 style={{ 
                      fontSize: '16px', 
                      fontWeight: '600',
                      color: COLORS.text
                    }}>Students:</h3>
                    <span style={{ 
                      background: COLORS.secondary, 
                      color: 'white',
                      borderRadius: '20px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {students.length}
                    </span>
                  </div>
                  
                  <ul style={{ 
                    maxHeight: '200px',
                    overflowY: 'auto',
                    padding: '0',
                    margin: '0 -20px',
                    listStyle: 'none'
                  }}>
                    {students.map(student => (
                      <li 
                        key={student}
                        style={{ 
                          padding: '10px 20px',
                          borderBottom: `1px solid ${COLORS.card}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <span role="img" aria-label="student">🎓</span>
                        <span>{student}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <button 
                    onClick={startExam}
                    disabled={isLoading.connectRoom}
                    style={{ 
                      width: '100%', 
                      padding: '12px', 
                      borderRadius: '10px',
                      border: 'none',
                      backgroundColor: COLORS.secondary,
                      color: 'white',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      marginTop: '16px',
                      opacity: isLoading.connectRoom ? 0.8 : 1
                    }}
                  >
                    {isLoading.connectRoom ? (
                      <>
                        <LoadingSpinner size={16} /> Connecting...
                      </>
                    ) : (
                      'Start Exam'
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600',
                  color: COLORS.text
                }}>Connected Students:</h3>
                <span style={{ 
                  background: COLORS.primary, 
                  color: 'white',
                  borderRadius: '20px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}>
                  {connectedStudents.length}
                </span>
              </div>
              
              <ul style={{ 
                maxHeight: '200px',
                overflowY: 'auto',
                padding: '0',
                margin: '0 -20px',
                listStyle: 'none'
              }}>
                {connectedStudents.map(studentId => (
                  <li 
                    key={studentId}
                    onClick={() => handleStudentSelect(studentId)}
                    style={{ 
                      padding: '10px 20px',
                      borderBottom: `1px solid ${COLORS.card}`,
                      cursor: 'pointer',
                      background: selectedStudent === studentId ? COLORS.card : 'transparent',
                      borderRadius: '8px',
                      transition: 'background 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <span role="img" aria-label="student">
                      {selectedStudent === studentId ? '👀' : '🎓'}
                    </span>
                    <span>{studentId}</span>
                  </li>
                ))}
              </ul>
              
              {!recording ? (
                <button 
                  onClick={startRecording}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: COLORS.error,
                    color: 'white',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '16px'
                  }}
                >
                  <span role="img" aria-label="record">🔴</span> Start Recording
                </button>
              ) : (
                <button 
                  onClick={stopRecording}
                  disabled={isLoading.generateZip}
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: COLORS.warning,
                    color: 'white',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '16px',
                    opacity: isLoading.generateZip ? 0.8 : 1
                  }}
                >
                  {isLoading.generateZip ? (
                    <>
                      <LoadingSpinner size={16} /> Processing...
                    </>
                  ) : (
                    'Stop & Download Recordings'
                  )}
                </button>
              )}
              
              <button 
                onClick={endExam}
                style={{ 
                  width: '100%', 
                  padding: '12px', 
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: COLORS.error,
                  color: 'white',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '12px'
                }}
              >
                <span role="img" aria-label="end">⏹️</span> End Exam
              </button>
            </>
          )}
          
          <div style={{ 
            marginTop: '24px', 
            padding: '12px',
            background: COLORS.darker,
            borderRadius: '10px',
            borderLeft: `3px solid ${COLORS.primary}`
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              marginBottom: '4px'
            }}>
              <div style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%',
                background: examStarted ? COLORS.secondary : COLORS.warning
              }} />
              <strong>Status:</strong>
            </div>
            <p style={{ 
              fontSize: '14px', 
              color: COLORS.textSecondary,
              margin: 0,
              lineHeight: 1.4
            }}>
              {status}
            </p>
          </div>
        </div>
        
        {/* Gamified Progress Tracker */}
        <div style={{ 
          background: COLORS.card, 
          borderRadius: '16px', 
          padding: '16px',
          marginTop: 'auto'
        }}>
          <h3 style={{ 
            fontSize: '14px', 
            fontWeight: '600', 
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span role="img" aria-label="progress">📊</span> Exam Progress
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '4px',
                fontSize: '12px'
              }}>
                <span>Student List</span>
                <span style={{ 
                  color: students.length > 0 ? COLORS.secondary : COLORS.textSecondary 
                }}>
                  {students.length > 0 ? 'Completed' : 'Pending'}
                </span>
              </div>
              <div style={{ 
                height: '6px', 
                background: COLORS.darker, 
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: students.length > 0 ? '100%' : '0%',
                    background: students.length > 0 ? COLORS.secondary : COLORS.textSecondary,
                    transition: 'width 0.5s ease'
                  }} 
                />
              </div>
            </div>
            
            <div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '4px',
                fontSize: '12px'
              }}>
                <span>Exam Room</span>
                <span style={{ 
                  color: examStarted ? COLORS.secondary : COLORS.textSecondary 
                }}>
                  {examStarted ? 'Active' : 'Pending'}
                </span>
              </div>
              <div style={{ 
                height: '6px', 
                background: COLORS.darker, 
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: examStarted ? '100%' : '0%',
                    background: examStarted ? COLORS.secondary : COLORS.textSecondary,
                    transition: 'width 0.5s ease'
                  }} 
                />
              </div>
            </div>
            
            <div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '4px',
                fontSize: '12px'
              }}>
                <span>Recordings</span>
                <span style={{ 
                  color: recording ? COLORS.warning : COLORS.textSecondary 
                }}>
                  {recording ? 'In Progress' : 'Not Started'}
                </span>
              </div>
              <div style={{ 
                height: '6px', 
                background: COLORS.darker, 
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: recording ? '100%' : '0%',
                    background: recording ? COLORS.warning : COLORS.textSecondary,
                    transition: 'width 0.5s ease'
                  }} 
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Main Content */}
      <div style={{ 
        flex: 1, 
        padding: '24px',
        background: COLORS.dark
      }}>
        <header style={{ 
          marginBottom: '24px', 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{ 
              fontSize: '28px', 
              fontWeight: 'bold',
              background: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.accent} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>Teacher Dashboard</h1>
            <p style={{ 
              color: COLORS.textSecondary, 
              fontSize: '16px',
              marginTop: '4px'
            }}>
              Monitor and manage your coding examination session
            </p>
          </div>
          <div style={{ 
            display: 'flex', 
            gap: '12px',
            background: COLORS.card,
            padding: '8px 16px',
            borderRadius: '12px'
          }}>
            <span role="img" aria-label="teacher">👨‍🏫</span>
            <span style={{ fontWeight: '500' }}>{teacherId || 'Not connected'}</span>
          </div>
        </header>
        
        {examStarted ? (
          <div>
            {selectedStudent && (
              <div style={{ 
                marginBottom: '24px', 
                border: `2px solid ${COLORS.primary}`,
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(74, 108, 247, 0.2)'
              }}>
                <div style={{ 
                  padding: '16px', 
                  background: COLORS.card,
                  borderBottom: `1px solid ${COLORS.darker}`
                }}>
                  <h2 style={{ 
                    fontSize: '20px', 
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span role="img" aria-label="focus">🔍</span> Focus View: {selectedStudent}
                  </h2>
                </div>
                <div style={{ 
                  padding: '16px', 
                  display: 'flex', 
                  justifyContent: 'center',
                  minHeight: '400px'
                }}>
                  <VideoCard 
                    track={streams.find(s => s.id === selectedStudent)?.track}
                    label={`${selectedStudent} (Focused)`}
                    recording={recording}
                    style={{ 
                      maxWidth: '100%', 
                      width: '100%',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                    }}
                  />
                </div>
              </div>
            )}
            
            <div style={{ 
              display: 'grid', 
              gap: '20px',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))'
            }}>
              {streams.map((stream) => (
                <VideoCard 
                  key={stream.id} 
                  track={stream.track} 
                  label={stream.id}
                  recording={recording}
                  onClick={() => handleStudentSelect(stream.id)}
                  isSelected={selectedStudent === stream.id}
                />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ 
            textAlign: 'center', 
            marginTop: '50px',
            padding: '40px',
            background: COLORS.card,
            borderRadius: '16px',
            border: `1px dashed ${COLORS.primary}33`
          }}>
            <div style={{ 
              fontSize: '64px', 
              marginBottom: '20px',
              display: 'inline-block'
            }}>
              <span role="img" aria-label="education">🎓</span>
            </div>
            <h2 style={{ 
              fontSize: '24px', 
              fontWeight: 'bold',
              marginBottom: '12px',
              background: `linear-gradient(90deg, ${COLORS.primary} 0%, ${COLORS.accent} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Ready to Start Your Exam
            </h2>
            <p style={{ 
              fontSize: '16px', 
              color: COLORS.textSecondary,
              maxWidth: '600px',
              margin: '0 auto 24px'
            }}>
              {students.length === 0 
                ? "Enter your teacher ID and fetch the student list to begin your examination session" 
                : "Click 'Start Exam' to begin monitoring your students' coding sessions"}
            </p>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center',
              gap: '16px',
              flexWrap: 'wrap'
            }}>
              <div style={{ 
                background: COLORS.darker, 
                padding: '16px', 
                borderRadius: '12px',
                width: '180px'
              }}>
                <div style={{ 
                  fontSize: '40px', 
                  marginBottom: '12px',
                  color: COLORS.primary
                }}>
                  1
                </div>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600',
                  marginBottom: '8px'
                }}>Enter ID</h3>
                <p style={{ 
                  fontSize: '14px', 
                  color: COLORS.textSecondary
                }}>Provide your teacher ID</p>
              </div>
              
              <div style={{ 
                background: COLORS.darker, 
                padding: '16px', 
                borderRadius: '12px',
                width: '180px'
              }}>
                <div style={{ 
                  fontSize: '40px', 
                  marginBottom: '12px',
                  color: COLORS.accent
                }}>
                  2
                </div>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600',
                  marginBottom: '8px'
                }}>Fetch Students</h3>
                <p style={{ 
                  fontSize: '14px', 
                  color: COLORS.textSecondary
                }}>Get your student list</p>
              </div>
              
              <div style={{ 
                background: COLORS.darker, 
                padding: '16px', 
                borderRadius: '12px',
                width: '180px'
              }}>
                <div style={{ 
                  fontSize: '40px', 
                  marginBottom: '12px',
                  color: COLORS.secondary
                }}>
                  3
                </div>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600',
                  marginBottom: '8px'
                }}>Start Exam</h3>
                <p style={{ 
                  fontSize: '14px', 
                  color: COLORS.textSecondary
                }}>Begin monitoring session</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VideoCard({ track, label, recording, onClick, isSelected, style }) {
  const videoRef = useRef(null);
  const [streamActive, setStreamActive] = useState(false);

  useEffect(() => {
    const videoElement = videoRef.current;
    
    const handleResize = () => {
      // Force reattach the track when window is resized (including fullscreen changes)
      if (track && videoElement) {
        track.detach(videoElement);
        track.attach(videoElement);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (track && videoElement) {
        track.detach(videoElement);
      }
    };
  }, [track]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (track && videoElement) {
      track.attach(videoElement);
      setStreamActive(true);
      
      // Add event listeners to monitor stream activity
      const handlePlay = () => setStreamActive(true);
      const handlePause = () => setStreamActive(false);
      
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      
      return () => {
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
      };
    }
  }, [track]);

  return (
    <div 
      style={{ 
        border: isSelected ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.card}`, 
        borderRadius: '12px',
        padding: '16px',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: COLORS.card,
        transition: 'all 0.2s ease',
        boxShadow: isSelected ? `0 0 0 3px ${COLORS.primary}33` : 'none',
        ...style
      }}
      onClick={onClick}
    >
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <strong style={{ 
          fontSize: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span role="img" aria-label="student">🎓</span>
          {label}
        </strong>
        {recording && (
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#EF444433',
            color: '#EF4444',
            padding: '4px 8px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '500'
          }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              background: '#EF4444',
              borderRadius: '50%',
              animation: 'pulse 1.5s infinite'
            }} />
            Recording
          </div>
        )}
      </div>
      
      <div style={{ 
        position: 'relative',
        paddingTop: '56.25%', // 16:9 aspect ratio
        borderRadius: '8px',
        overflow: 'hidden',
        background: streamActive ? 'transparent' : '#000'
      }}>
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted // Important for autoplay in modern browsers
          style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'transparent',
            borderRadius: '8px',
            display: streamActive ? 'block' : 'none'
          }} 
        />
        {!streamActive && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.textSecondary,
            fontSize: '14px'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📹</div>
              {track ? 'Connecting stream...' : 'No stream available'}
            </div>
          </div>
        )}
      </div>
      
      {isSelected && (
        <div style={{ 
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: COLORS.primary,
          color: 'white',
          padding: '4px 12px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: '500',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          FOCUS
        </div>
      )}
    </div>
  );
}