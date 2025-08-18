// TeacherDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Room } from 'livekit-client';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const LIVEKIT_URL = "wss://educode-190pkw3r.livekit.cloud";
const BACKEND_URL = "https://edu-code-one.vercel.app";

export default function TeacherDashboard() {
  const [teacherId, setTeacherId] = useState('');
  const [students, setStudents] = useState([]);
  const [connectedStudents, setConnectedStudents] = useState([]);
  const [status, setStatus] = useState('Enter your teacher ID');
  const [examStarted, setExamStarted] = useState(false);
  const [room, setRoom] = useState(null);
  const [streams, setStreams] = useState([]);
  const [recording, setRecording] = useState(false);
  const mediaRecorders = useRef({});
  const recordedChunks = useRef({});

  const fetchStudentList = async () => {
    if (!teacherId) return;
    
    try {
      setStatus('Fetching student list...');
      const response = await fetch(`${BACKEND_URL}/teachers/getStudentList/${teacherId}`);
      const data = await response.json();
      console.log(data.studentList);
      setStudents(data.studentList);
      setStatus(`Found ${data.studentList.length} students`);
    } catch (error) {
      console.error('Error fetching students:', error);
      setStatus('Error fetching students');
    }
  };

  const startExam = async () => {
    try {
      setStatus('Connecting to exam room...');
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

      // Listen for participant connections
      newRoom.on('participantConnected', (participant) => {
        setConnectedStudents(prev => [...prev, participant.identity]);
      });

      // Listen for track subscriptions
      newRoom.on('trackSubscribed', (track, publication, participant) => {
        if (track.kind === "video") {
          setStreams(prev => [...prev, { 
            track, 
            id: participant.identity,
            name: students.find(s => s.id === participant.identity)?.name || participant.identity
          }]);
        }
      });

      // Listen for participant disconnections
      newRoom.on('participantDisconnected', (participant) => {
        setConnectedStudents(prev => prev.filter(id => id !== participant.identity));
        setStreams(prev => prev.filter(s => s.id !== participant.identity));
      });

    } catch (e) {
      console.error("Error connecting teacher:", e);
      setStatus("Error: " + e.message);
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
      
      mediaRecorder.start(1000); // Collect data every second
      mediaRecorders.current[stream.id] = mediaRecorder;
    });
  };

  const stopRecording = async () => {
    setRecording(false);
    
    // Stop all recorders
    Object.values(mediaRecorders.current).forEach(recorder => {
      recorder.stop();
    });
    
    // Wait for all recorders to finish
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create zip file
    const zip = new JSZip();
    const dateStr = new Date().toISOString().split('T')[0];
    
    // Add each recording to zip
    for (const [studentId, chunks] of Object.entries(recordedChunks.current)) {
      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: 'video/webm' });
        zip.file(`${studentId}.webm`, blob);
      }
    }
    
    // Generate and download zip
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `exam-recordings-${dateStr}.zip`);
  };

  const endExam = async () => {
    if (room) {
      await room.disconnect();
    }
    setExamStarted(false);
    setConnectedStudents([]);
    setStreams([]);
    setStatus('Exam ended');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ width: '250px', background: '#f0f0f0', padding: '20px' }}>
        <h2>Exam Control</h2>
        
        {!examStarted ? (
          <>
            <div>
              <label>Teacher ID:</label>
              <input 
                type="text" 
                value={teacherId} 
                onChange={(e) => setTeacherId(e.target.value)} 
                style={{ width: '100%', padding: '8px', margin: '10px 0' }}
              />
            </div>
            <button 
              onClick={fetchStudentList}
              style={{ width: '100%', padding: '10px', margin: '5px 0' }}
            >
              Fetch Student List
            </button>
            
            {students.length > 0 && (
              <>
                <h3>Students:</h3>
                <ul>
                  {students.map(student => (
                    <li key={student}>{student} ({student})</li>
                  ))}
                </ul>
                <button 
                  onClick={startExam}
                  style={{ width: '100%', padding: '10px', margin: '5px 0', background: 'green', color: 'white' }}
                >
                  Start Exam
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <h3>Connected Students:</h3>
            <ul>
              {connectedStudents.map(studentId => (
                <li key={studentId}>
                  {students.find(s => s.id === studentId)?.name || studentId}
                </li>
              ))}
            </ul>
            
            {!recording ? (
              <button 
                onClick={startRecording}
                style={{ width: '100%', padding: '10px', margin: '5px 0', background: 'red', color: 'white' }}
              >
                Start Recording
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                style={{ width: '100%', padding: '10px', margin: '5px 0', background: 'orange', color: 'white' }}
              >
                Stop & Download Recordings
              </button>
            )}
            
            <button 
              onClick={endExam}
              style={{ width: '100%', padding: '10px', margin: '5px 0', background: 'darkred', color: 'white' }}
            >
              End Exam
            </button>
          </>
        )}
        
        <div style={{ marginTop: '20px', color: '#666' }}>
          Status: {status}
        </div>
      </div>
      
      {/* Main Content */}
      <div style={{ flex: 1, padding: '20px' }}>
        <h1>Teacher Dashboard</h1>
        
        {examStarted ? (
          <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {streams.map((stream) => (
              <VideoCard 
                key={stream.id} 
                track={stream.track} 
                label={`${stream.name} (${stream.id})`}
                recording={recording}
              />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', marginTop: '50px' }}>
            {students.length === 0 ? (
              <p>Enter your teacher ID and fetch student list to begin</p>
            ) : (
              <p>Click "Start Exam" to begin the examination session</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoCard({ track, label, recording }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (track && videoRef.current) {
      track.attach(videoRef.current);
    }
    return () => {
      if (track) track.detach(videoRef.current);
    };
  }, [track]);

  return (
    <div style={{ border: '1px solid #ddd', padding: '10px', position: 'relative' }}>
      <strong>{label}</strong>
      <div style={{ 
        position: 'absolute', 
        top: '10px', 
        right: '10px', 
        background: recording ? 'red' : 'transparent', 
        width: '10px', 
        height: '10px', 
        borderRadius: '50%'
      }}></div>
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        style={{ width: '100%', background: 'black', marginTop: '10px' }} 
      />
    </div>
  );
}