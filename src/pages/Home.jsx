// StudentScreenShare.jsx
import React, { useEffect, useState, useRef } from "react";
import { Room, LocalVideoTrack } from "livekit-client";

const LIVEKIT_URL = "wss://educode-190pkw3r.livekit.cloud";
const BACKEND_URL = "https://edu-code-one.vercel.app";
const regId = "UNI001";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const roomRef = useRef(null);
  const [streamStarted, setStreamStarted] = useState(false);

  useEffect(() => {
    // (async () => {
    //   try {
    //     // Prevent double connect on fast refresh / re-render
    //     if (streamStarted) {
    //       console.log("Already connected, skipping...");
    //       return;
    //     }

    //     // 1) Fetch token
    //     const res = await fetch(`${BACKEND_URL}/getToken?ID=${regId}`);
    //     const data = await res.json();
    //     const token = data.token;

    //     const room = new Room();
    //     await room.connect(LIVEKIT_URL, token);
    //     roomRef.current = room; // Save to ref

    //     // 2) Get screen stream only ONCE
    //     const stream = await navigator.mediaDevices.getDisplayMedia({
    //       video: true,
    //       audio: false
    //     });
    //     console.log(stream.getVideoTracks());
    //     const [videoTrack] = stream.getVideoTracks();
    //     const localTrack = new LocalVideoTrack(videoTrack);

    //     await room.localParticipant.publishTrack(localTrack);
    //     console.log("Screen publsished to LiveKit");
    //     setConnected(true);
    //     setStreamStarted(true);

    //   } catch (err) {
    //     console.error("Error:", err);
    //   }
    // })();
  }, []);

  const handleWarning = (warning) => {
    if(warning.warning){
      alert(warning.msg);
      console.log("Proctoring warning: Please Look at the Screen Properly");
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Student Share</h2>
      {connected ? <p>Screen sharing started</p> : <p>Connecting...</p>}
    </div>
  );
}
