// TeacherDashboard.jsx
import React, { useEffect, useState } from "react";
import { Room } from "livekit-client";

const LIVEKIT_URL = "wss://educode-190pkw3r.livekit.cloud";
const BACKEND_URL = "https://edu-code-one.vercel.app"; // Your backend running server.js

export default function Teacher() {
  const [status, setStatus] = useState("Connecting...");
  const [streams, setStreams] = useState([]); // array of { id, track, label }

  useEffect(() => {
    initTeacher();
  }, []);

  async function initTeacher() {
    try {
      const teacherId = "T001";
      const res = await fetch(`${BACKEND_URL}/createToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ID: teacherId,
          studentList: ["UNI001", "UNI002"] // assign your students here
        })
      });
      const data = await res.json();
      const token = data.token;

      // Connect to LiveKit room
      const room = new Room();
      await room.connect(LIVEKIT_URL, token);
      setStatus("Connected as Teacher");

      // Listen for any subscribed tracks (each student screen)
      room.on("trackSubscribed", (track, publication, participant) => {
        if (track.kind === "video") {
          const label = participant.identity || "student";
          setStreams((prev) => [...prev, { track, label, id: participant.identity }]);
        }
      });
    } catch (e) {
      console.error("Error connecting teacher:", e);
      setStatus("Error: " + e.message);
    }
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2>Teacher LiveKit Dashboard</h2>
      <p>{status}</p>

      <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {streams.map((s, index) => (
          <VideoCard key={index} track={s.track} label={s.label} />
        ))}
      </div>
    </div>
  );
}

// Separate component to attach video track
function VideoCard({ track, label }) {
  const videoRef = React.useRef(null);

  useEffect(() => {
    if (track && videoRef.current) {
      track.attach(videoRef.current);
    }
    return () => {
      if (track) track.detach(videoRef.current);
    };
  }, [track]);

  return (
    <div style={{ border: "1px solid #ddd", padding: "10px" }}>
      <strong>{label}</strong>
      <video ref={videoRef} autoPlay playsInline style={{ width: "100%", background: "black", marginTop: "10px" }} />
    </div>
  );
}
