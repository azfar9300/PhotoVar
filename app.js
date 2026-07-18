// State & Variabel Global
let peer;
let dataConn; // Untuk kirim data (shutter, pass control)
let currentCall; // Untuk streaming video
let localStream;
let hasControl = true;
let isCapturing = false;
let capturedPhotos = [];

// DOM Elements
const videoLocal = document.getElementById('video-local');
const videoRemote = document.getElementById('video-remote');
const canvasLocal = document.getElementById('canvas-local');
const canvasRemote = document.getElementById('canvas-remote');
const canvasComposite = document.getElementById('canvas-composite');
const stripCanvas = document.getElementById('photos-strip');

const ctxLocal = canvasLocal.getContext('2d');
const ctxRemote = canvasRemote.getContext('2d');
const ctxComposite = canvasComposite.getContext('2d');
const stripCtx = stripCanvas.getContext('2d');

const btnCall = document.getElementById('btn-call');
const btnSnap = document.getElementById('btn-snap');
const btnPass = document.getElementById('btn-pass');
const btnDownload = document.getElementById('btn-download');

const peerIdInput = document.getElementById('peer-id-input');
const connectionStatus = document.getElementById('connection-status');
const currentControllerText = document.getElementById('current-controller');
const countdownEl = document.getElementById('countdown');

// ==========================================
// 1. MEDIAPIPE AI SETUP (PROCESS EACH STREAM)
// ==========================================
// Kita pakai 2 instance AI terpisah: Satu untuk Lokal, satu untuk Remote
const aiLocal = new SelfieSegmentation({ locateFile: (file) => `[https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/$](https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/$){file}` });
const aiRemote = new SelfieSegmentation({ locateFile: (file) => `[https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/$](https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/$){file}` });

aiLocal.setOptions({ modelSelection: 1 }); // 1 = landscape mode
aiRemote.setOptions({ modelSelection: 1 });

aiLocal.onResults((results) => onSegmentationResults(results, ctxLocal, canvasLocal, videoLocal));
aiRemote.onResults((results) => onSegmentationResults(results, ctxRemote, canvasRemote, videoRemote));

function onSegmentationResults(results, ctx, canvas, sourceVideo) {
    // 1. Bersihkan canvas
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 2. Gambar mask dari AI
    ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
    
    // 3. Trik Composite: Hanya gambar video di dalam mask (Background otomatis transparan)
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    ctx.restore();
}

// ==========================================
// 2. MAIN COMPOSITING (PANGGUNG UTAMA BERDUA)
// ==========================================
// Fungsi ini berjalan terus-menerus (requestAnimationFrame) untuk menggabungkan 2 canvas AI tadi ke 1 panggung.
function drawCompositeStage() {
    // 1. Bersihkan panggung utama
    ctxComposite.clearRect(0, 0, canvasComposite.width, canvasComposite.height);
    
    // Opsional: Kasih background studio virtual di sini sebelum menggambar orangnya
    // Misal: ctxComposite.drawImage(studioBgImage, 0, 0, canvasComposite.width, canvasComposite.height);

    // 2. Gambar Orang Lokal (misal: di kiri)
    // Kita menempatkannya bersandingan agar "bertemu"
    const orangW = 640;
    const orangH = 480;
    const paddingBawah = 0; // Tempel di bawah

    // Posisikan Orang Lokal (Kiri-Tengah)
    const xLokal = 0 + (canvasComposite.width / 2 - orangW) / 2 + 100; // Contoh positioning
    const yLokal = canvasComposite.height - orangH - paddingBawah;
    ctxComposite.drawImage(canvasLocal, xLokal, yLokal, orangW, orangH);

    // 3. Gambar Orang Remote (misal: di kanan)
    const xRemote = canvasComposite.width / 2 + (canvasComposite.width / 2 - orangW) / 2 - 100; // Contoh positioning
    const yRemote = canvasComposite.height - orangH - paddingBawah;
    ctxComposite.drawImage(canvasRemote, xRemote, yRemote, orangW, orangH);

    // Panggil ulang terus
    requestAnimationFrame(drawCompositeStage);
}

// Buka Kamera Device
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then(stream => {
        localStream = stream;
        videoLocal.srcObject = stream;
        videoLocal.addEventListener('playing', () => {
            // Jalankan deteksi AI Lokal setelah video mulai play
            async function detectionFrameLokal() {
                if (!videoLocal.paused && !videoLocal.ended) {
                    await aiLocal.send({ image: videoLocal });
                }
                requestAnimationFrame(detectionFrameLokal);
            }
            detectionFrameLokal();
        });
        
        // Mulai render panggung utama (composite)
        drawCompositeStage();
    })
    .catch(err => alert("Gagal mengakses kamera: " + err));


// ==========================================
// 3. NETWORK & VIDEO CALL LOGIC (PEERJS)
// ==========================================
peer = new Peer(); // Menggunakan public server broker gratis PeerJS

peer.on('open', (id) => {
    document.getElementById('my-id').innerText = id;
});

// Menghandle device lain yang MEMANGGIL kita (Call)
peer.on('call', (call) => {
    connectionStatus.innerText = "Menerima panggilan video...";
    // Jawab panggilan dengan stream lokal kita
    call.answer(localStream);
    handleCall(call);
});

// Menghandle device lain yang menghubungi via Data (Connection)
peer.on('connection', (incomingDataConn) => {
    dataConn = incomingDataConn;
    setupDataListeners();
    connectionStatus.innerText = "Terhubung data dengan device remote!";
    hasControl = false; // Yang menerima sambungan mengalah dulu
    updateControlUI();
});

// Aksi tombol hubungkan manual ke device teman (Call + Connect)
btnCall.addEventListener('click', () => {
    const peerId = peerIdInput.value.trim();
    if (!peerId) return alert("Masukkan ID teman terlebih dahulu!");
    
    connectionStatus.innerText = "Mencoba memanggil teman...";
    
    // 1. Panggil Streaming Video
    const call = peer.call(peerId, localStream);
    handleCall(call);

    // 2. Hubungkan Data Channel (untuk shutter & pass control)
    dataConn = peer.connect(peerId);
    setupDataListeners();
});

function handleCall(call) {
    currentCall = call;
    call.on('stream', (remoteStream) => {
        videoRemote.srcObject = remoteStream;
        videoRemote.addEventListener('playing', () => {
            connectionStatus.innerText = "Kalian berdua bertemu di panggung!";
            // Jalankan deteksi AI Remote setelah video remote mulai play
            async function detectionFrameRemote() {
                if (!videoRemote.paused && !videoRemote.ended) {
                    await aiRemote.send({ image: videoRemote });
                }
                requestAnimationFrame(detectionFrameRemote);
            }
            detectionFrameRemote();
        });
    });
    call.on('close', () => { connectionStatus.innerText = "Panggilan video ditutup."; });
}

function setupDataListeners() {
    dataConn.on('open', () => {
        // connectionStatus.innerText = "Terhubung data jarak jauh!";
        hasControl = true; // Si pemanggil koneksi memegang kendali awal
        updateControlUI();
    });

    // Mendengarkan instruksi/data masuk dari device remote
    dataConn.on('data', (data) => {
        if (data.type === 'START_SHOOT') {
            runShootSequence();
        } else if (data.type === 'PASS_CONTROL') {
            hasControl = true;
            updateControlUI();
        }
    });
}

function updateControlUI() {
    currentControllerText.innerText = hasControl ? "Lokal (Anda)" : "Teman Anda (Jarak Jauh)";
    btnSnap.disabled = !hasControl;
    btnPass.disabled = !hasControl;
}

// Mengoper hak kendali memicu jepretan foto
btnPass.addEventListener('click', () => {
    if (!dataConn) return;
    hasControl = false;
    updateControlUI();
    dataConn.send({ type: 'PASS_CONTROL' });
});


// ==========================================
// 4. SHUTTER SYSTEM (FOTO FRAME GABUNGAN)
// ==========================================
btnSnap.addEventListener('click', () => {
    if (!hasControl || !dataConn) return alert("Belum terhubung penuh ke device teman.");
    if (dataConn) dataConn.send({ type: 'START_SHOOT' }); // Suruh device sebelah ikut hitung mundur
    runShootSequence();
});

function runShootSequence() {
    if (isCapturing) return;
    isCapturing = true;
    capturedPhotos = [];
    let photoCount = 0;
    
    function takeNext() {
        let timeLeft = 3;
        countdownEl.innerText = timeLeft;

        let interval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                countdownEl.innerText = timeLeft;
            } else {
                clearInterval(interval);
                countdownEl.innerText = "📸"; // Jepret!
                
                setTimeout(() => {
                    countdownEl.innerText = "";
                    // Tangkap Frame Utama (Composite Stage)
                    captureFrameToArray();
                    photoCount++;
                    
                    if (photoCount < 3) {
                        takeNext();
                    } else {
                        isCapturing = false;
                        generatePhotoboothCard();
                    }
                }, 400); // Jeda flash sebentar
            }
        }, 1000);
    }
    takeNext();
}

function captureFrameToArray() {
    // Manfaatkan canvas bayangan (offscreen) untuk freeze frame gambar transparan PANGGUNG UTAMA
    const memCanvas = document.createElement('canvas');
    memCanvas.width = canvasComposite.width;
    memCanvas.height = canvasComposite.height;
    const memCtx = memCanvas.getContext('2d');
    memCtx.drawImage(canvasComposite, 0, 0);
    capturedPhotos.push(memCanvas);
}


// ==========================================
// 5. CANVAS CARD STITCHING & DOWNLOAD
// ==========================================
function generatePhotoboothCard() {
    if (capturedPhotos.length < 3) return;
    
    // Bersihkan canvas strip foto utama
    stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);
    
    const xOffset = 20; // Margin kiri-kanan kartu
    let yOffset = 40;  // Margin atas kartu
    
    // Di kartu, foto panggung gabungan (1280x720) kita kecilkan
    const targetW = 400; // Kartu lebih lebar sedikit
    const targetH = 225; // 16:9 ratio

    capturedPhotos.forEach((photo) => {
        // Kotak bayangan latar belakang per foto (putih tipis agar orang transparan tidak hilang)
        stripCtx.fillStyle = "rgba(255, 255, 255, 0.05)";
        stripCtx.fillRect(xOffset, yOffset, targetW, targetH);
        
        // Render panggung utama hasil tangkapan berdua tadi
        stripCtx.drawImage(photo, xOffset, yOffset, targetW, targetH);
        yOffset += targetH + 30; // Kasih space jarak antar foto ke bawah
    });

    // Tampilkan canvas hasil dan tombol unduh
    stripCanvas.style.display = "inline-block";
    btnDownload.style.display = "inline-block";
}

// Download hasil jadi PNG Transparan
btnDownload.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'photobooth-berdua-satuframe.png';
    link.href = stripCanvas.toDataURL('image/png');
    link.click();
});
