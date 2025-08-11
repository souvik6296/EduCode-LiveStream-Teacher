
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SIGNALING_URL = "http://localhost:3000";

const Home = () => {
    const [regId, setRegId] = useState("");
    const [joinedRoom, setJoinedRoom] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const startedStreamRef = useRef(false);
        // ref to always have latest regId in socket handlers
    const regIdRef = useRef("");

    useEffect(() => {
        regIdRef.current = regId;
    }, [regId]);

    // refs to hold mutable values for callbacks (avoid stale closures)
    const socketRef = useRef(null);
    const joinedRoomRef = useRef(null);
    const pcRef = useRef(null);
    const pendingCandidatesRef = useRef([]); // candidates received before pc ready
    const videoRef = useRef(null);
    // store teacher socket id for signaling
    const teacherSocketIdRef = useRef(null);

    useEffect(() => {
        joinedRoomRef.current = joinedRoom;
    }, [joinedRoom]);

    useEffect(() => {
        // init socket once
        const socket = io(SIGNALING_URL);
        socketRef.current = socket;

        socket.on("connect", () => {
            console.log("connected to signaling server:", socket.id);
        });

        socket.on("disconnect", () => {
            console.log("disconnected from signaling server");
        });

        socket.on("message", (msg) => {
            console.log("message:", msg);
        });

        // new room -> join if allowed
        socket.on("newRoom", ({roomName, allowedStudents, teacherSocketId}) => {
            console.log("newRoom event received:", {roomName, allowedStudents, teacherSocketId});
            if (teacherSocketId) teacherSocketIdRef.current = teacherSocketId;
            const current = regIdRef.current;
            if (allowedStudents?.includes(current)) {
                socket.emit("joinRoom", { roomName, id: current });
                setJoinedRoom(roomName);
            }
        });

        // VIDEO ANSWER from teacher
        socket.on("videoAnswer", async ({ from, answer }) => {
            console.log("received videoAnswer from", from);
            const pc = pcRef.current;
            if (!pc) {
                console.warn("No peerConnection yet — ignoring answer");
                return;
            }
            // only set remote if we expect an answer
            if (pc.signalingState === "have-local-offer") {
                try {
                    await pc.setRemoteDescription(answer);
                    console.log("setRemoteDescription(answer) success");
                    // apply any pending remote ICE candidates
                    if (pendingCandidatesRef.current.length) {
                        for (const c of pendingCandidatesRef.current) {
                            try {
                                await pc.addIceCandidate(new RTCIceCandidate(c));
                            } catch (err) {
                                console.warn("error adding queued candidate", err);
                            }
                        }
                        pendingCandidatesRef.current = [];
                    }
                } catch (err) {
                    console.error("error setting remote description", err);
                }
            } else {
                console.warn("Skipping setRemoteDescription(answer) because signalingState is", pc.signalingState);
            }
        });

        // ICE candidate from teacher
        socket.on("iceCandidate", async ({ candidate }) => {
            const pc = pcRef.current;
            if (!pc) {
                // queue candidate until pc exists and remote description applied
                pendingCandidatesRef.current.push(candidate);
                console.log("queued remote ICE candidate (pc not ready)");
                return;
            }
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log("added remote ICE candidate");
            } catch (err) {
                console.error("error adding remote ICE candidate:", err);
            }
        });

        return () => {
            // cleanup socket on unmount
            socket.disconnect();
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Start screen share and signaling
    const startStream = async () => {
        if (localStream) return;
        if (!socketRef.current) {
            console.warn("Socket not ready yet");
            return;
        }
        if (!joinedRoomRef.current) {
            alert("You must be in a room to start streaming (wait for teacher to create room).");
            return;
        }

        try {
            // 1) get display media
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            setLocalStream(stream);
            if (videoRef.current) videoRef.current.srcObject = stream;

            // 2) create RTCPeerConnection AFTER we have the stream
            // ensure previous pc closed
            if (pcRef.current) {
                try {
                    pcRef.current.close();
                } catch (e) { }
                pcRef.current = null;
            }

            const pc = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            });
            pcRef.current = pc;

            // 3) add tracks (important BEFORE createOffer)
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
            console.log("local tracks added to pc");

            // 4) set onicecandidate BEFORE createOffer
            pc.onicecandidate = (event) => {
                console.log("pc.onicecandidate fired:", !!event.candidate);
                if (event.candidate && teacherSocketIdRef.current && socketRef.current) {
                    socketRef.current.emit("iceCandidate", {
                        candidate: event.candidate,
                        to: teacherSocketIdRef.current,
                        from: socketRef.current.id
                    });
                    console.log("sent local ICE candidate to server");
                }
            };

            // optional: log connection state for debugging
            pc.onconnectionstatechange = () => {
                console.log("pc.connectionState:", pc.connectionState);
            };

            // 5) create offer and send it
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log("localDescription set (offer)");

            socketRef.current.emit("videoOffer", {
                from: socketRef.current.id,
                offer,
                to: teacherSocketIdRef.current,
                regId: regId
            });
            console.log("videoOffer emitted to server");

            startedStreamRef.current = true;
        } catch (err) {
            console.error("startStream error:", err);
        }
    };

    // simple cleanup function
    const stopStreamAndClose = () => {
        if (localStream) {
            localStream.getTracks().forEach((t) => t.stop());
            setLocalStream(null);
        }
        if (pcRef.current) {
            try {
                pcRef.current.close();
            } catch (e) { }
            pcRef.current = null;
        }
        startedStreamRef.current = false;
        pendingCandidatesRef.current = [];
    };

    // UI: join room (teacher will create room and emit newRoom)
    const handleJoinRoomManually = () => {
        const name = prompt("Enter room name to join (teacher should have created it):");
        if (!name) return;
        setJoinedRoom(name);
        joinedRoomRef.current = name;
        // inform server of join
        socketRef.current?.emit("joinRoom", { roomName: name, id: regId });
    };

    useEffect(() => {
        // cleanup on component unmount
        return () => stopStreamAndClose();
    }, []); // run once

    return (
        <div style={{ padding: 20 }}>
            <h2>Student Screen Share</h2>

            <div style={{ marginBottom: 8 }}>
                <label>Reg ID:  {regId}</label>
                <input value={regId} onChange={(e) => setRegId(e.target.value)} placeholder="Enter reg id" />
            </div>

            <div style={{ marginBottom: 8 }}>
                <button onClick={handleJoinRoomManually}>Join Room Manually</button>
                <span style={{ marginLeft: 8 }}>{joinedRoom ? `Joined: ${joinedRoom}` : "Not in a room"}</span>
            </div>

            <div style={{ marginBottom: 8 }}>
                <video ref={videoRef} width={480} height={300} autoPlay playsInline controls={false} />
            </div>

            <div style={{ gap: 8 }}>
                <button onClick={startStream}>Start Screen Share</button>
                <button onClick={stopStreamAndClose} style={{ marginLeft: 8 }}>
                    Stop
                </button>
            </div>
        </div>
    );
};

export default Home;
