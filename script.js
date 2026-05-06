 <!-- JAVASCRIPT LOGIC -->
    <script type="text/javascript">
        // Ensure globals exist
        const SUPABASE_URL = 'https://oioahcavhgvtrsigxcgp.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pb2FoY2F2aGd2dHJzaWd4Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NTYxMTIsImV4cCI6MjA4MzIzMjExMn0.QLFPg0J1NgV6cO43Xa5sU60w34OS6Zf5f8hTobKT1Vg';
        const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

        const firebaseConfig = {
            apiKey: "AIzaSyC77JSotwFbQzhPIMgVvu_hVileMYLeCNU",
            authDomain: "crochat-kp.firebaseapp.com",
            databaseURL: "https://crochat-kp-default-rtdb.firebaseio.com",
            projectId: "crochat-kp",
            storageBucket: "crochat-kp.firebasestorage.app",
            messagingSenderId: "979535359566",
            appId: "1:979535359566:web:339ea23557a8bf8644dd1f",
            measurementId: "G-P9TCSJZ4JX"
        };

        let fbDb, fbRef, fbPush, fbOnChildAdded, fbServerTimestamp, fbOnValue, fbSet, fbRemove;
        let currentChatUnsubscribe = null;
        let currentTypingUnsubscribe = null;
        let chatRoomId = null;

        // Import Firebase Dynamically
        import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js').then(module => {
            const { initializeApp } = module;
            const app = initializeApp(firebaseConfig);
            
            import('https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js').then(dbModule => {
                fbDb = dbModule.getDatabase(app);
                fbRef = dbModule.ref;
                fbPush = dbModule.push;
                fbOnChildAdded = dbModule.onChildAdded;
                fbServerTimestamp = dbModule.serverTimestamp;
                fbOnValue = dbModule.onValue;
                fbSet = dbModule.set;
                fbRemove = dbModule.remove;
            });
        }).catch(err => console.error("Firebase load error:", err));

        // ==========================
        // REWARD SYSTEM LOGIC
        // ==========================
        const RewardSystem = {
            state: { points: 0, uploads: 0, shares: 0, downloads: 0, history: [] },
            
            init() {
                const stored = localStorage.getItem('flux_rewards');
                if (stored) {
                    try {
                        this.state = JSON.parse(stored);
                    } catch(e) { console.error("Error loading rewards"); }
                }
                this.updateUI();
            },
            
            save() {
                localStorage.setItem('flux_rewards', JSON.stringify(this.state));
                this.updateUI();
            },
            
            award(type, refId = null) {
                // Anti-spam check for specific transfers
                if (refId && this.state.history.includes(`${type}_${refId}`)) return;
                
                let pts = 0;
                let msg = '';
                
                if (type === 'upload') { pts = 5; this.state.uploads++; msg = 'Uploading files'; }
                if (type === 'share') { pts = 10; this.state.shares++; msg = 'Sharing your file'; }
                if (type === 'download') { pts = 20; this.state.downloads++; msg = 'Someone downloaded your file'; }
                
                this.state.points += pts;
                if (refId) this.state.history.push(`${type}_${refId}`);
                
                // Keep history size manageable
                if (this.state.history.length > 200) this.state.history.shift();
                
                this.save();
                showSnackbar(`🎉 You earned +${pts} points for ${msg}!`, 'success');
            },

            spend(amount, reason) {
                if (this.state.points >= amount) {
                    this.state.points -= amount;
                    this.save();
                    showSnackbar(`Spent ${amount} points for ${reason}.`, 'success');
                    return true;
                }
                return false;
            },
            
            getLevel() {
                if (this.state.points >= 500) return { name: 'Master 👑', color: 'text-yellow-400', bg: 'bg-yellow-400/20', border: 'border-yellow-400/30' };
                if (this.state.points >= 100) return { name: 'Pro 🚀', color: 'text-purple-400', bg: 'bg-purple-400/20', border: 'border-purple-400/30' };
                return { name: 'Beginner 🌱', color: 'text-emerald-400', bg: 'bg-emerald-400/20', border: 'border-emerald-400/30' };
            },
            
            updateUI() {
                // Update Header
                const headPoints = document.getElementById('header-points');
                if(headPoints) headPoints.innerText = this.state.points;
                
                // Update Dashboard
                const dashPoints = document.getElementById('dashboard-points');
                if(dashPoints) dashPoints.innerText = this.state.points;
                
                const statU = document.getElementById('stat-uploads');
                if(statU) statU.innerText = this.state.uploads;
                
                const statS = document.getElementById('stat-shares');
                if(statS) statS.innerText = this.state.shares;
                
                const statD = document.getElementById('stat-downloads');
                if(statD) statD.innerText = this.state.downloads;
                
                const levelEl = document.getElementById('dashboard-level');
                if(levelEl) {
                    const levelInfo = this.getLevel();
                    levelEl.innerText = levelInfo.name;
                    levelEl.className = `px-3 py-1 rounded-lg font-bold text-sm border ${levelInfo.bg} ${levelInfo.color} ${levelInfo.border}`;
                }
            }
        };

        // Application State Limits
        const MAX_FILES_LIMIT = 2000;
        const MAX_TOTAL_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
        
        let selectedFiles = []; 
        
        // Fast Mode State
        let isFastModeEnabled = false;
        let baseConcurrency = 5;
        let fastConcurrency = 25; // Boosted Concurrency

        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
            fastConcurrency = Math.min(10, navigator.hardwareConcurrency * 2);
        }

        let uploadState = {
            isUploading: false,
            isPaused: false,
            isCanceled: false,
            activeUploads: 0,
            completedBytes: 0,
            totalBytes: 0,
            folder: '',
            code: '',
            fileMeta: [],
            message: '',
            pin: '',
            expiresAt: ''
        };

        let myId = null;
        let currentSessionChannel = null;
        let pendingFileTransfer = null; 
        let connectedPeerId = null;
        let inboxCount = 0;
        
        let peerConnection = null;
        let localStream = null;
        let isCalling = false;
        const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

        let touchStartX = 0;
        let touchEndX = 0;
        const tabOrder = ['upload', 'receive', 'connect', 'inbox', 'activity', 'settings'];

        let html5QrCode;

        // Storage Helper to prevent Mobile Safari / Private Mode crashes
        const StorageHelper = {
            get: function(key) {
                try { return localStorage.getItem(key); } 
                catch(e) {
                    try { return sessionStorage.getItem(key); } 
                    catch(e) { return window['temp_' + key] || null; }
                }
            },
            set: function(key, value) {
                try { localStorage.setItem(key, value); } 
                catch(e) {
                    try { sessionStorage.setItem(key, value); } 
                    catch(e) { window['temp_' + key] = value; }
                }
            },
            remove: function(key) {
                try { localStorage.removeItem(key); } catch(e) {}
                try { sessionStorage.removeItem(key); } catch(e) {}
                delete window['temp_' + key];
            }
        };

        // ==========================
        // SMART ONBOARDING LOGIC
        // ==========================
        let currentOnboardingStep = 1;
        const totalOnboardingSteps = 4;

        function checkOnboarding() {
            if (!StorageHelper.get('flux_onboarding_done')) {
                showOnboarding();
            }
        }

        function showOnboarding() {
            currentOnboardingStep = 1;
            updateOnboardingUI();
            const modal = document.getElementById('onboarding-modal');
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                document.getElementById('onboarding-content').classList.remove('scale-95');
            }, 10);
        }

        function nextStep() {
            if (currentOnboardingStep < totalOnboardingSteps) {
                currentOnboardingStep++;
                updateOnboardingUI();
            } else {
                finishOnboarding();
            }
        }

        function prevStep() {
            if (currentOnboardingStep > 1) {
                currentOnboardingStep--;
                updateOnboardingUI();
            }
        }

        function skipOnboarding() {
            finishOnboarding();
        }

        function finishOnboarding() {
            StorageHelper.set('flux_onboarding_done', 'true');
            const modal = document.getElementById('onboarding-modal');
            modal.classList.add('opacity-0');
            document.getElementById('onboarding-content').classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 500);
        }

        function updateOnboardingUI() {
            // Update progress bar
            const prog = (currentOnboardingStep / totalOnboardingSteps) * 100;
            document.getElementById('onboarding-progress').style.width = `${prog}%`;

            // Hide all steps, show current
            for (let i = 1; i <= totalOnboardingSteps; i++) {
                const stepEl = document.getElementById(`step-${i}`);
                if (i === currentOnboardingStep) {
                    stepEl.classList.add('active');
                } else {
                    stepEl.classList.remove('active');
                }
            }

            // Update button texts/visibility
            const btnPrev = document.getElementById('btn-prev-step');
            const btnNext = document.getElementById('btn-next-step');

            if (currentOnboardingStep === 1) {
                btnPrev.classList.add('hidden');
            } else {
                btnPrev.classList.remove('hidden');
            }

            if (currentOnboardingStep === totalOnboardingSteps) {
                btnNext.innerText = 'Got It!';
            } else {
                btnNext.innerText = 'Next';
            }
        }

        function updateLastCodeUI() {
            const activity = JSON.parse(localStorage.getItem('flux_activity') || '[]');
            const lastUpload = activity.find(a => a.type === 'upload');
            const display = document.getElementById('last-code-display');
            if(lastUpload && display) {
                display.classList.remove('hidden');
                document.getElementById('last-code-val').innerText = lastUpload.code;
            }
        }

        function copyLastCode() {
            const display = document.getElementById('last-code-display');
            if(display && display.innerText) {
                const code = document.getElementById('last-code-val').innerText;
                navigator.clipboard.writeText(code);
                showSnackbar('Last code copied!');
            }
        }

        // Initialize Setup
        document.addEventListener('DOMContentLoaded', () => {
            changeFont('Outfit');
            RewardSystem.init(); // Initialize Rewards
            checkOnboarding(); // Check if onboarding needed
            updateLastCodeUI(); // Update last code badge
        });

        // UI Interactions
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('animate-slide-up'));
            const selected = document.getElementById(tabId + '-tab');
            if(selected) {
                selected.classList.remove('hidden');
                void selected.offsetWidth;
                selected.classList.add('animate-slide-up');
            }
            document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(btn => {
                if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabId)) btn.classList.add('active');
            });
            if(tabId === 'inbox') { inboxCount = 0; updateInboxBadges(false); }
            if(tabId === 'activity') renderActivity();
        }

        function handleFastModeToggle(checkbox) {
            if (checkbox.checked) {
                const cost = 50;
                const canAfford = RewardSystem.state.points >= cost;
                
                Swal.fire({
                    title: 'Enable Fast Upload (20x) ⚡',
                    html: `
                        <div class="mb-4 text-sm text-slate-300">
                            Fast mode unlocks maximum parallel uploads to boost your transfer speed.<br><br>
                            You have <b><span class="text-yellow-400">${RewardSystem.state.points} points</span></b>.
                        </div>
                    `,
                    input: 'text',
                    inputPlaceholder: 'Enter Coupon Code (or leave blank to use points)',
                    showCancelButton: true,
                    showDenyButton: true,
                    denyButtonText: `Use ${cost} Points`,
                    confirmButtonText: 'Apply Coupon',
                    confirmButtonColor: '#4f46e5',
                    denyButtonColor: canAfford ? '#eab308' : '#475569',
                    background: '#1e293b',
                    color: '#fff',
                    customClass: { popup: 'border border-white/10' }
                }).then((result) => {
                    if (result.isConfirmed && result.value.trim() !== '') {
                        // Coupon Logic
                        const code = result.value.trim().toUpperCase();
                        const validCodes = ['FAST20', 'KPBOOST', 'SPEEDX', 'POMSD', 'BINTE'];
                        if (validCodes.includes(code)) {
                            activateFastMode();
                        } else {
                            checkbox.checked = false;
                            showSnackbar('Invalid Coupon Code', 'error');
                        }
                    } else if (result.isDenied) {
                        // Points Logic
                        if(canAfford) {
                            RewardSystem.spend(cost, "Fast Upload Mode");
                            activateFastMode();
                        } else {
                            checkbox.checked = false;
                            showSnackbar('Not enough points!', 'error');
                        }
                    } else {
                        checkbox.checked = false;
                    }
                });
            } else {
                isFastModeEnabled = false;
                document.getElementById('fast-mode-badge').classList.add('hidden');
                document.getElementById('speed-indicator').classList.add('hidden');
                showSnackbar('Fast Mode Disabled');
            }
        }
        
        function activateFastMode() {
            isFastModeEnabled = true;
            document.getElementById('check-fast-mode').checked = true;
            document.getElementById('fast-mode-badge').classList.remove('hidden');
            document.getElementById('speed-indicator').classList.remove('hidden');
            Swal.fire({
                icon: 'success',
                title: 'Fast Mode Activated!',
                text: 'Warning: Fast mode may use more data and CPU.',
                background: '#1e293b',
                color: '#fff',
                confirmButtonColor: '#10b981'
            });
        }

        function toggleOption(id, isChecked) {
            const el = document.getElementById(id);
            if (isChecked) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
                el.value = '';
            }
        }

        function showSnackbar(msg, type = 'success') {
            const bar = document.getElementById('snackbar');
            const icon = document.getElementById('snack-icon');
            const text = document.getElementById('snack-msg');
            text.innerText = msg;
            bar.classList.remove('opacity-0', 'translate-y-[-20px]');
            icon.className = type === 'error' ? 'ph-fill ph-warning-circle text-xl text-red-400' : 'ph-fill ph-check-circle text-xl text-emerald-400';
            bar.classList.toggle('border-red-500/30', type === 'error');
            setTimeout(() => bar.classList.add('opacity-0', 'translate-y-[-20px]'), 4000);
        }

        function changeFont(fontName) {
            document.body.style.fontFamily = `'${fontName}', sans-serif`;
            localStorage.setItem('flux_font', fontName);
        }

        function changeLanguage(lang) {
            localStorage.setItem('flux_lang', lang);
            if(lang === 'hi') {
                showSnackbar('Hindi selected');
            } else {
                showSnackbar('English selected');
            }
        }

        // Auth Logic
        async function initAuth() {
            if(supabaseClient) {
                try {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session) handleLoggedInUser(session.user);
                    else initGuestMode();
                } catch(e) {
                    console.error("[Auth] Session check failed, falling back to guest:", e);
                    initGuestMode();
                }
            } else {
                initGuestMode();
            }
        }

        function updateIdentityUI(isLoggedIn) {
            const displays = ['myIdDisplay', 'connect-my-id-display', 'user-flux-id'];
            displays.forEach(id => {
                const el = document.getElementById(id);
                if(el) el.innerText = myId || '------';
            });
            
            const dot = document.getElementById('auth-status-dot');
            if (dot) {
                dot.className = isLoggedIn ? "w-2 h-2 rounded-full bg-emerald-500" : "w-2 h-2 rounded-full bg-slate-500";
                dot.title = isLoggedIn ? "Logged In" : "Guest Mode";
            }
            
            const profileSec = document.getElementById('profile-section');
            if (profileSec) {
                isLoggedIn ? profileSec.classList.remove('hidden') : profileSec.classList.add('hidden');
            }
        }

        function handleLoggedInUser(user) {
            myId = user.user_metadata?.flux_id || Math.floor(10000 + Math.random() * 90000).toString();
            updateIdentityUI(true);
            document.getElementById('user-email-display').innerText = user.email;
            initRealtime();
        }

        function initGuestMode() {
            try {
                let guestId = StorageHelper.get('flux_my_id');
                if (!guestId || !/^\d{5}$/.test(guestId)) {
                    guestId = Math.floor(10000 + Math.random() * 90000).toString(); 
                    StorageHelper.set('flux_my_id', guestId);
                } 
                myId = guestId;
                updateIdentityUI(false);
                initRealtime();
            } catch(e) {
                console.error("[Auth] Critical storage failure, assigning temp ID", e);
                myId = Math.floor(10000 + Math.random() * 90000).toString();
                updateIdentityUI(false);
            }
        }

        async function handleLogout() { 
            if(supabaseClient) await supabaseClient.auth.signOut(); 
            StorageHelper.remove('flux_my_id');
            window.location.reload(); 
        }

        // ==========================
        // QUEUE SYSTEM (BULK UPLOAD & MALWARE CHECK)
        // ==========================

        const SUSPICIOUS_EXTENSIONS = ['exe', 'bat', 'apk', 'js', 'html', 'sh', 'msi', 'cmd', 'vbs', 'scr'];
        let tempPendingFilesForSecurity = [];

        function handleFileSelect(input) {
            if (uploadState.isUploading) return;
            const files = Array.from(input.files);
            if (files.length === 0) return;
            interceptAndCheckFiles(files);
            input.value = ''; 
        }

        function interceptAndCheckFiles(newFiles) {
            if (uploadState.isUploading) return;

            let suspiciousFound = [];
            for (const file of newFiles) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (SUSPICIOUS_EXTENSIONS.includes(ext)) {
                    suspiciousFound.push(file);
                }
            }

            if (suspiciousFound.length > 0) {
                tempPendingFilesForSecurity = newFiles;
                showSecurityModal(suspiciousFound);
            } else {
                showSafeFileToast();
                processAndAddFilesToQueue(newFiles);
            }
        }

        function showSafeFileToast() {
            showSnackbar("✅ Files look safe", "success");
        }

        function showSecurityModal(suspiciousFiles) {
            const listEl = document.getElementById('suspicious-file-list');
            listEl.innerHTML = '';
            
            suspiciousFiles.forEach(f => {
                const div = document.createElement('div');
                div.className = "text-xs text-red-300 truncate";
                div.innerHTML = `<i class="ph-bold ph-warning text-red-500 mr-2"></i> ${f.name}`;
                listEl.appendChild(div);
            });

            document.getElementById('security-checkbox').checked = false;
            document.getElementById('btn-proceed-unsafe').disabled = true;
            document.getElementById('btn-proceed-unsafe').classList.add('opacity-50', 'cursor-not-allowed');

            const modal = document.getElementById('security-modal');
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                document.getElementById('security-content').classList.remove('scale-95');
            }, 10);
        }

        function toggleSecurityProceed(checkbox) {
            const btn = document.getElementById('btn-proceed-unsafe');
            if (checkbox.checked) {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            } else {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            }
        }

        function cancelSuspiciousUpload() {
            tempPendingFilesForSecurity = [];
            const modal = document.getElementById('security-modal');
            modal.classList.add('opacity-0');
            document.getElementById('security-content').classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
        }

        function proceedSuspiciousUpload() {
            const filesToAdd = [...tempPendingFilesForSecurity];
            cancelSuspiciousUpload();
            processAndAddFilesToQueue(filesToAdd);
        }

        function processAndAddFilesToQueue(newFiles) {
            if (uploadState.isUploading) return;

            let totalSize = selectedFiles.reduce((acc, f) => acc + f.file.size, 0);
            let addedCount = 0;
            let sizeExceeded = false;
            
            for (const file of newFiles) {
                if (file.size === 0 && !file.type) continue;
                if (selectedFiles.length >= MAX_FILES_LIMIT) {
                    showSnackbar(`Max limit of ${MAX_FILES_LIMIT} files reached.`, 'error');
                    break;
                }
                if (totalSize + file.size > MAX_TOTAL_SIZE_BYTES) {
                    sizeExceeded = true;
                    continue;
                }
                
                selectedFiles.push({
                    id: Math.random().toString(36).substr(2, 9),
                    file: file,
                    customPath: file.customPath || file.webkitRelativePath || file.name,
                    status: 'pending', 
                    error: null,
                    retries: 0
                });
                totalSize += file.size;
                addedCount++;
            }
            
            if (sizeExceeded) showSnackbar('Total queue size cannot exceed 5GB.', 'error');
            else if (addedCount > 0) showSnackbar(`Added ${addedCount} files to queue.`);
            
            renderFileList();
        }

        const dropZone = document.getElementById('drop-zone');
        if(dropZone) {
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); if(!uploadState.isUploading) dropZone.classList.add('border-indigo-500'); });
            dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('border-indigo-500'); });
            dropZone.addEventListener('drop', async (e) => {
                e.preventDefault();
                dropZone.classList.remove('border-indigo-500');
                if (uploadState.isUploading) return;
                
                const items = e.dataTransfer.items;
                let extractedFiles = [];
                
                if (items) {
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        if (item.kind === 'file') {
                            const entry = item.webkitGetAsEntry();
                            if (entry) await traverseFileTree(entry, '', extractedFiles);
                        }
                    }
                } else {
                    extractedFiles = Array.from(e.dataTransfer.files);
                }
                interceptAndCheckFiles(extractedFiles);
            });
        }

        async function traverseFileTree(item, path, fileList) {
            path = path || "";
            if (item.isFile) {
                const file = await new Promise(resolve => item.file(resolve));
                file.customPath = path + file.name;
                fileList.push(file);
            } else if (item.isDirectory) {
                const dirReader = item.createReader();
                const entries = await readAllEntries(dirReader);
                for (const entry of entries) {
                    await traverseFileTree(entry, path + item.name + "/", fileList);
                }
            }
        }

        async function readAllEntries(dirReader) {
            let entries = [];
            let readEntries = await new Promise(resolve => dirReader.readEntries(resolve));
            while (readEntries.length > 0) {
                entries.push(...readEntries);
                readEntries = await new Promise(resolve => dirReader.readEntries(resolve));
            }
            return entries;
        }

        // --- URL Upload Logic ---
        async function loadFileFromUrl() {
            if (uploadState.isUploading) return;
            const input = document.getElementById('url-upload-input');
            const url = input.value.trim();
            if (!url) return showSnackbar('Please enter a valid URL', 'error');

            const btn = input.nextElementSibling;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>';
            btn.disabled = true;

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const blob = await response.blob();
                let filename = url.split('/').pop().split('#')[0].split('?')[0];
                if (!filename) filename = 'downloaded_file';
                if (!filename.includes('.')) {
                    const ext = blob.type.split('/')[1] || 'bin';
                    filename += '.' + ext;
                }

                const file = new File([blob], decodeURIComponent(filename), { type: blob.type });
                interceptAndCheckFiles([file]);
                input.value = '';
                showSnackbar('File loaded from URL successfully!');
            } catch (error) {
                console.error('URL Fetch Error:', error);
                showSnackbar('Failed to load URL (Network or CORS error)', 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        // --- Paste Upload Logic ---
        document.addEventListener('paste', (e) => {
            if (uploadState.isUploading) return;
            const activeTag = document.activeElement.tagName.toLowerCase();
            const inInput = activeTag === 'input' || activeTag === 'textarea';

            const items = e.clipboardData.items;
            const files = [];
            
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file) files.push(file);
                }
            }
            
            if (files.length > 0) {
                if (inInput && !files[0].type.startsWith('image/')) return;
                e.preventDefault();
                interceptAndCheckFiles(files);
            }
        });

        // Determine specific icons for preview panel
        function getFileIconMarkup(file) {
            if (file.type.startsWith('image/')) {
                return `<img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover" loading="lazy" style="border-radius: 0.5rem;"/>`;
            } else if (file.type.startsWith('video/')) {
                return `<i class="ph-fill ph-video-camera text-pink-400 text-2xl"></i>`;
            } else if (file.type === 'application/pdf') {
                return `<i class="ph-fill ph-file-pdf text-red-400 text-2xl"></i>`;
            } else {
                return `<i class="ph-fill ph-file text-indigo-400 text-2xl"></i>`;
            }
        }

        // Full UI Render of Queue List
        function renderFileList() {
            const listContainer = document.getElementById('file-list-container');
            const emptyState = document.getElementById('empty-state');
            const list = document.getElementById('file-list');
            const addButtons = document.getElementById('queue-add-buttons');
            const removeAllBtn = document.getElementById('btn-remove-all');
            const warningBox = document.getElementById('large-upload-warning');
            
            if (selectedFiles.length > 0) {
                listContainer.classList.remove('hidden');
                emptyState.classList.add('hidden');
                dropZone.classList.remove('min-h-[340px]');
            } else {
                listContainer.classList.add('hidden');
                emptyState.classList.remove('hidden');
                dropZone.classList.add('min-h-[340px]');
                return; // Nothing to render
            }

            // Warnings and Blocks when uploading
            if (selectedFiles.length > 100) {
                warningBox.classList.remove('hidden');
            } else {
                warningBox.classList.add('hidden');
            }

            if (uploadState.isUploading) {
                addButtons.classList.add('hidden');
                removeAllBtn.classList.add('hidden');
            } else {
                addButtons.classList.remove('hidden');
                removeAllBtn.classList.remove('hidden');
            }

            let totalSize = 0;
            
            // Build Document Fragment for perf on large lists
            const fragment = document.createDocumentFragment();

            selectedFiles.forEach((item, index) => {
                totalSize += item.file.size;
                const sizeStr = (item.file.size / 1024 / 1024).toFixed(2) + ' MB';
                const displayPath = item.customPath;

                // Determine icon state
                let statusHtml = '';
                let canRemove = !uploadState.isUploading || (item.status === 'pending' || item.status === 'error');

                if (item.status === 'pending') {
                    statusHtml = getFileIconMarkup(item.file);
                } else if (item.status === 'uploading') {
                    statusHtml = `<div class="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin"></div>`;
                } else if (item.status === 'done') {
                    statusHtml = `<i class="ph-bold ph-check text-emerald-400 text-xl"></i>`;
                } else if (item.status === 'error') {
                    statusHtml = `<i class="ph-bold ph-warning-circle text-red-400 text-xl" title="${item.error}"></i>`;
                }
                
                const div = document.createElement('div');
                div.id = `file-row-${item.id}`;
                div.className = `flex justify-between items-center bg-white/5 hover:bg-white/10 transition-colors p-2 rounded-xl text-sm border border-white/5 mb-1 ${item.status === 'error' ? 'bg-red-500/10 border-red-500/30' : ''}`;
                
                div.innerHTML = `
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div id="status-icon-${item.id}" class="w-10 h-10 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden shrink-0 border border-white/5">
                            ${statusHtml}
                        </div>
                        <div class="flex flex-col overflow-hidden text-left w-32 md:w-56">
                            <span class="truncate text-xs font-bold ${item.status === 'error' ? 'text-red-300' : 'text-slate-200'}" title="${displayPath}">${displayPath}</span>
                            <span class="text-[10px] text-slate-500 font-mono">${sizeStr}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1">
                        ${item.status === 'error' && uploadState.isUploading && !uploadState.isCanceled ? `<button onclick="event.stopPropagation(); retryFile('${item.id}')" class="p-2 text-amber-400 hover:text-amber-300 transition-colors" title="Retry"><i class="ph-bold ph-arrows-clockwise"></i></button>` : ''}
                        ${canRemove ? `<button onclick="event.stopPropagation(); removeFile('${item.id}')" class="p-2 text-slate-500 hover:text-red-400 transition-colors"><i class="ph-bold ph-x"></i></button>` : ''}
                    </div>
                `;
                fragment.appendChild(div);
            });
            
            list.innerHTML = '';
            list.appendChild(fragment);

            const totalStats = document.getElementById('total-stats');
            if (totalStats) {
                totalStats.innerText = `${selectedFiles.length} / ${MAX_FILES_LIMIT} files • ${(totalSize / 1024 / 1024).toFixed(2)} MB`;
            }
        }

        // Targeted UI update (Avoids full render during active bulk upload)
        function updateFileRowStatus(id) {
            if (!uploadState.isUploading) return; 
            const item = selectedFiles.find(f => f.id === id);
            if (!item) return;

            const iconContainer = document.getElementById(`status-icon-${id}`);
            const rowContainer = document.getElementById(`file-row-${id}`);
            if (!iconContainer || !rowContainer) return;

            if (item.status === 'uploading') {
                iconContainer.innerHTML = `<div class="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin"></div>`;
            } else if (item.status === 'done') {
                iconContainer.innerHTML = `<i class="ph-bold ph-check text-emerald-400 text-xl"></i>`;
            } else if (item.status === 'error') {
                iconContainer.innerHTML = `<i class="ph-bold ph-warning-circle text-red-400 text-xl" title="${item.error}"></i>`;
                rowContainer.classList.add('bg-red-500/10', 'border-red-500/30');
            } else if (item.status === 'pending') {
                iconContainer.innerHTML = getFileIconMarkup(item.file);
                rowContainer.classList.remove('bg-red-500/10', 'border-red-500/30');
            }
        }

        function removeFile(id) {
            const idx = selectedFiles.findIndex(f => f.id === id);
            if (idx > -1) {
                selectedFiles.splice(idx, 1);
                uploadState.totalBytes = selectedFiles.reduce((acc, f) => acc + f.file.size, 0);
                renderFileList();
            }
        }

        function removeAllFiles() {
            selectedFiles = [];
            renderFileList();
        }

        function retryFile(id) {
            const item = selectedFiles.find(f => f.id === id);
            if (item) {
                item.status = 'pending';
                item.error = null;
                item.retries = 0; // Reset retries on manual retry
                updateFileRowStatus(id);
                renderFileList();
                if (uploadState.isUploading && !uploadState.isPaused && !uploadState.isCanceled) {
                    runUploadPool();
                }
            }
        }

        // ==========================
        // BULK UPLOAD EXECUTION
        // ==========================

        async function startUpload() {
            if (selectedFiles.length === 0) {
                return showSnackbar('Queue is empty', 'error');
            }
            if (uploadState.isUploading) return;

            // Lock UI & Initialize State
            uploadState.isUploading = true;
            uploadState.isPaused = false;
            uploadState.isCanceled = false;
            uploadState.activeUploads = 0;
            uploadState.completedBytes = selectedFiles.filter(f => f.status === 'done').reduce((acc, f) => acc + f.file.size, 0);
            uploadState.totalBytes = selectedFiles.reduce((acc, f) => acc + f.file.size, 0);
            
            if(!uploadState.code) {
                document.getElementById('progress-status-text').innerText = "Generating Code...";
                let newCode = Math.floor(10000 + Math.random() * 90000).toString(); // 5-digit code generated
                
                // Safe duplicate check if database exists
                if (supabaseClient) {
                    try {
                        let isUnique = false;
                        let attempts = 0;
                        while(!isUnique && attempts < 5) {
                            const { data } = await supabaseClient.from('transfers').select('code').eq('code', newCode).maybeSingle();
                            if(!data) {
                                isUnique = true;
                            } else {
                                newCode = Math.floor(10000 + Math.random() * 90000).toString();
                                attempts++;
                            }
                        }
                    } catch(e) { console.error("Code verification skipped", e); }
                }

                uploadState.code = newCode;
                uploadState.folder = `${Date.now()}_${uploadState.code}`;
                uploadState.fileMeta = [];
                uploadState.message = document.getElementById('msg-box').value;
                uploadState.pin = document.getElementById('pin-box').value;
                const expirySeconds = parseInt(document.getElementById('expiry-select').value);
                uploadState.expiresAt = new Date(new Date().getTime() + expirySeconds * 1000).toISOString();
            }

            // Hide normal send buttons, show progress + controls
            document.getElementById('btn-send').classList.add('hidden');
            document.getElementById('uploadProgressContainer').classList.remove('hidden');
            
            // Disable certain UI elements to prevent tampering
            document.getElementById('option-fast-card').classList.add('opacity-50', 'pointer-events-none');
            document.getElementById('option-msg-card').classList.add('opacity-50', 'pointer-events-none');
            document.getElementById('option-pin-card').classList.add('opacity-50', 'pointer-events-none');
            document.getElementById('option-expiry-card').classList.add('opacity-50', 'pointer-events-none');

            updateControlsUI();
            renderFileList(); // Update to remove add/remove buttons

            runUploadPool();
        }

        function pauseUpload() {
            if (!uploadState.isUploading) return;
            uploadState.isPaused = true;
            document.getElementById('progress-status-text').innerText = "Paused...";
            updateControlsUI();
        }

        function resumeUpload() {
            if (!uploadState.isUploading) return;
            uploadState.isPaused = false;
            document.getElementById('progress-status-text').innerText = "Transferring...";
            updateControlsUI();
            runUploadPool();
        }

        function cancelUpload() {
            if (!uploadState.isUploading) return;
            uploadState.isCanceled = true;
            uploadState.isUploading = false;
            document.getElementById('progress-status-text').innerText = "Canceled";
            showSnackbar('Upload Canceled', 'error');
            resetUploadUIState();
        }

        function updateControlsUI() {
            const pauseBtn = document.getElementById('btn-pause-upload');
            const resumeBtn = document.getElementById('btn-resume-upload');
            
            if (uploadState.isPaused) {
                pauseBtn.classList.add('hidden');
                resumeBtn.classList.remove('hidden');
            } else {
                pauseBtn.classList.remove('hidden');
                resumeBtn.classList.add('hidden');
            }
        }

        function updateProgressUI() {
            if (!uploadState.isUploading) return;
            const progress = uploadState.totalBytes === 0 ? 100 : (uploadState.completedBytes / uploadState.totalBytes) * 100;
            const cleanProg = Math.min(100, Math.max(0, progress));
            
            document.getElementById('uploadProgressBar').style.width = `${cleanProg}%`;
            document.getElementById('uploadStats').innerText = `${cleanProg.toFixed(1)}%`;
            document.getElementById('progress-status-text').innerText = "Transferring...";
        }

        function runUploadPool() {
            if (uploadState.isPaused || uploadState.isCanceled) {
                checkOverallCompletion();
                return;
            }

            // Fallback to normal mode if too many pending files to prevent crashing
            const pendingFilesCount = selectedFiles.filter(f => f.status === 'pending').length;
            if (isFastModeEnabled && pendingFilesCount > 1000) {
                isFastModeEnabled = false;
                document.getElementById('check-fast-mode').checked = false;
                document.getElementById('fast-mode-badge').classList.add('hidden');
                document.getElementById('speed-indicator').classList.add('hidden');
                showSnackbar('Auto-fallback to normal mode due to high file count', 'error');
            }

            let concurrencyLimit = isFastModeEnabled ? fastConcurrency : baseConcurrency;

            while (uploadState.activeUploads < concurrencyLimit && !uploadState.isPaused && !uploadState.isCanceled) {
                const nextItem = selectedFiles.find(f => f.status === 'pending');
                if (!nextItem) break;
                
                processSingleFile(nextItem);
            }
            checkOverallCompletion();
        }

        async function processSingleFile(item) {
            uploadState.activeUploads++;
            item.status = 'uploading';
            updateFileRowStatus(item.id);

            try {
                const sanitizedPath = item.customPath.replace(/[^a-zA-Z0-9.\-\/]/g, '_');
                const filePath = `${uploadState.folder}/${sanitizedPath}`;

                if (supabaseClient) {
                    const { error } = await supabaseClient.storage.from('uploads').upload(filePath, item.file);
                    if (error) throw error;
                    const { data: { publicUrl } } = supabaseClient.storage.from('uploads').getPublicUrl(filePath);
                    uploadState.fileMeta.push({ name: item.customPath, size: (item.file.size / 1024 / 1024).toFixed(2) + ' MB', type: item.file.type, url: publicUrl });
                } else {
                    // Delay based on mode
                    let delay = 500;
                    if (isFastModeEnabled) {
                        delay = 0; // Fast mode
                    } else {
                        delay = Math.min(3000, Math.max(500, (item.file.size / 1024 / 1024) * 100)); // Normal mode
                    }
                    await new Promise(r => setTimeout(r, delay));
                    uploadState.fileMeta.push({ name: item.customPath, size: (item.file.size / 1024 / 1024).toFixed(2) + ' MB', type: item.file.type, url: '#' });
                }

                item.status = 'done';
                uploadState.completedBytes += item.file.size;
            } catch (err) {
                // Auto-retry logic (up to 2 times)
                if (item.retries < 2) {
                    item.retries++;
                    item.status = 'pending';
                } else {
                    item.status = 'error';
                    item.error = err.message || 'Failed';
                }
            } finally {
                uploadState.activeUploads--;
                updateFileRowStatus(item.id);
                updateProgressUI();
                
                // Triggers next file or completion check
                runUploadPool();
            }
        }

        async function checkOverallCompletion() {
            if (uploadState.activeUploads > 0) return;
            if (uploadState.isPaused || uploadState.isCanceled) return;
            
            const hasPending = selectedFiles.some(f => f.status === 'pending');
            if (hasPending) return; 

            const hasErrors = selectedFiles.some(f => f.status === 'error');
            if (hasErrors) {
                document.getElementById('progress-status-text').innerText = "Finished with Errors";
                showSnackbar('Some files failed. Retry them or cancel.', 'error');
                renderFileList(); 
                return;
            }

            // All successful! Finalize to DB.
            finalizeDatabaseEntry();
        }

        async function finalizeDatabaseEntry() {
            document.getElementById('progress-status-text').innerText = "Finalizing...";
            
            try {
                if (connectedPeerId && supabaseClient) {
                    const channel = currentSessionChannel || supabaseClient.channel(`room_${connectedPeerId}`);
                    // Send in chunks of 10 to avoid payload size limits on websockets
                    const chunkSize = 10;
                    for (let i = 0; i < uploadState.fileMeta.length; i += chunkSize) {
                        const chunk = uploadState.fileMeta.slice(i, i + chunkSize);
                        for(const file of chunk) {
                            await channel.send({ type: 'broadcast', event: 'incoming_file', payload: { ...file, from: myId } });
                        }
                    }
                    if (uploadState.message) {
                        await channel.send({ type: 'broadcast', event: 'incoming_file', payload: { type: 'message', content: uploadState.message, from: myId } });
                    }
                    
                    showSnackbar('All files sent to Peer!');
                    
                    // Render locally in chat
                    const roomContainer = document.getElementById('room-messages');
                    if(roomContainer.querySelector('.italic')) roomContainer.innerHTML = '';
                    uploadState.fileMeta.forEach(f => {
                        const msgDiv = document.createElement('div');
                        msgDiv.className = 'ml-auto max-w-[85%] scale-in glass-panel p-3 rounded-2xl rounded-tr-sm bg-indigo-500/20 border-indigo-500/30 mb-2';
                        msgDiv.innerHTML = `<div class="flex items-center gap-3"><div class="w-8 h-8 rounded bg-white/10 flex items-center justify-center"><i class="ph-fill ph-check text-indigo-300"></i></div><span class="text-xs font-bold truncate text-slate-200">${f.name}</span></div>`;
                        roomContainer.appendChild(msgDiv);
                    });
                    
                    addToActivity({ type: 'direct_sent', peer: connectedPeerId, files: uploadState.fileMeta, date: new Date().toLocaleString(), code: uploadState.code });
                } else {
                    if(supabaseClient) {
                        const { error: dbError } = await supabaseClient.from('transfers').insert({ 
                            code: uploadState.code, 
                            files: uploadState.fileMeta, 
                            message: uploadState.message || null, 
                            pin: uploadState.pin || null, 
                            expires_at: uploadState.expiresAt
                        });
                        if (dbError) throw dbError;
                    }
                    
                    const shareUrl = `${window.location.href.split('?')[0]}?code=${uploadState.code}`;
                    document.getElementById('final-code').innerText = uploadState.code;
                    document.getElementById('share-link-text').innerText = shareUrl;
                    document.getElementById('qr-container').innerHTML = '';
                    new QRCode(document.getElementById('qr-container'), { text: shareUrl, width: 140, height: 140, colorDark : "#1e293b", colorLight : "#ffffff" });
                    addToActivity({ type: 'upload', code: uploadState.code, files: uploadState.fileMeta, date: new Date().toLocaleString() });
                    
                    const modal = document.getElementById('success-modal');
                    modal.classList.remove('hidden');
                    setTimeout(() => { modal.classList.remove('opacity-0'); document.getElementById('success-modal-content').classList.remove('scale-95'); }, 10);
                }

                // Reward Trigger
                RewardSystem.award('upload', uploadState.code);
                
                resetUploadUIState();
                removeAllFiles();
                updateLastCodeUI(); // Refresh last code UI

            } catch (err) {
                showSnackbar(err.message || 'Failed to save transfer data', 'error');
                document.getElementById('progress-status-text').innerText = "Database Error";
            }
        }

        function resetUploadUIState() {
            uploadState = {
                isUploading: false,
                isPaused: false,
                isCanceled: false,
                activeUploads: 0,
                completedBytes: 0,
                totalBytes: 0,
                folder: '',
                code: '',
                fileMeta: [],
                message: '',
                pin: '',
                expiresAt: ''
            };
            
            document.getElementById('btn-send').classList.remove('hidden');
            document.getElementById('uploadProgressContainer').classList.add('hidden');
            document.getElementById('uploadProgressBar').style.width = '0%';
            
            document.getElementById('option-fast-card').classList.remove('opacity-50', 'pointer-events-none');
            document.getElementById('option-msg-card').classList.remove('opacity-50', 'pointer-events-none');
            document.getElementById('option-pin-card').classList.remove('opacity-50', 'pointer-events-none');
            document.getElementById('option-expiry-card').classList.remove('opacity-50', 'pointer-events-none');

            document.getElementById('msg-box').value = '';
            document.getElementById('pin-box').value = '';
            
            renderFileList(); // Re-enable add/remove buttons
        }

        function closeModal() { const modal = document.getElementById('success-modal'); modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 300); }
        
        function copyCode() { 
            const code = document.getElementById('final-code').innerText;
            navigator.clipboard.writeText(code); 
            RewardSystem.award('share', code);
            showSnackbar('Code copied'); 
        }
        
        function copyLink() { 
            const code = document.getElementById('final-code').innerText;
            navigator.clipboard.writeText(document.getElementById('share-link-text').innerText); 
            RewardSystem.award('share', code);
            showSnackbar('Link copied'); 
        }
        
        function shareWhatsApp() {
            const code = document.getElementById('final-code').innerText;
            const shareUrl = document.getElementById('share-link-text').innerText;
            const waMessage = `📁 File Shared via KP Flux Share\n\n🔑 Code: ${code}\n🔗 Receive Link: ${shareUrl}\n\n📥 Steps to receive files:\n1. Click the link OR scan QR code\n2. Enter the code (if required)\n3. Download your files\n\n⚡ Fast & Secure File Sharing`;
            window.open(`https://wa.me/?text=${encodeURIComponent(waMessage)}`, '_blank');
            RewardSystem.award('share', code);
        }

        function downloadQR() {
            const code = document.getElementById('final-code').innerText;
            const container = document.getElementById('qr-container');
            const img = container.querySelector('img');
            const canvas = container.querySelector('canvas');
            let url = '';
            if (img && img.src) url = img.src;
            else if (canvas) url = canvas.toDataURL("image/png");

            if (url) {
                const a = document.createElement('a');
                a.href = url;
                a.download = `FluxShare_QR_${code}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                RewardSystem.award('share', code);
                showSnackbar('QR Code downloaded successfully!');
            } else showSnackbar('Failed to download QR code', 'error');
        }

        // Receive Logic
        async function fetchFiles() {
            const code = document.getElementById('code-input').value.trim();
            if (code.length !== 5) return showSnackbar('Invalid Code', 'error');
            const btn = document.getElementById('btn-receive'), txt = document.getElementById('btn-receive-text'), load = document.getElementById('btn-receive-loader');
            btn.disabled = true; txt.classList.add('hidden'); load.classList.remove('hidden');

            try {
                if(!supabaseClient) throw new Error("Database not connected");
                const { data, error } = await supabaseClient.from('transfers').select('*').eq('code', code).single();
                if (error || !data) throw new Error('Transfer not found');
                
                if (new Date(data.expires_at) < new Date()) {
                    throw new Error('Expired');
                }
                
                if (data.pin) {
                    pendingFileTransfer = data;
                    document.getElementById('pin-modal-title').innerText = "Locked Transfer";
                    document.getElementById('pin-modal-desc').innerText = "Enter PIN to access files";
                    document.getElementById('pin-modal').classList.remove('hidden');
                } else {
                    addToActivity({ type: 'download', code: code, files: data.files, date: new Date().toLocaleString() });
                    renderReceivedFiles(data);
                }
            } catch (err) { showSnackbar(err.message, 'error'); } 
            finally { btn.disabled = false; txt.classList.remove('hidden'); load.classList.add('hidden'); }
        }

        function renderReceivedFiles(data) {
            const container = document.getElementById('receive-result');
            container.innerHTML = ''; container.classList.remove('hidden');
            
            if (data.files.length > 1) {
                const downloadAllBtn = document.createElement('button');
                downloadAllBtn.className = 'w-full mb-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2';
                downloadAllBtn.innerHTML = '<i class="ph-bold ph-download-simple"></i> Download All Files';
                downloadAllBtn.onclick = () => downloadAll(data.files, data.code);
                container.appendChild(downloadAllBtn);
            }

            if (data.message) {
                const msgDiv = document.createElement('div');
                msgDiv.className = 'glass-panel p-4 rounded-xl mb-4 bg-yellow-500/5 border-yellow-500/20';
                msgDiv.innerHTML = `<p class="text-[10px] font-bold uppercase tracking-widest text-yellow-500 mb-1">Message</p><p class="text-sm text-yellow-100 italic">"${data.message}"</p>`;
                container.appendChild(msgDiv);
            }

            const list = document.createElement('div'); list.className = 'space-y-3';
            
            // Fragment optimization for large receives
            const fragment = document.createDocumentFragment();
            data.files.forEach(file => {
                const isImg = file.type && file.type.startsWith('image/');
                const isVid = file.type && file.type.startsWith('video/');
                const isPdf = file.type === 'application/pdf';
                
                let iconHtml = `<i class="ph-fill ph-file text-xl text-cyan-400"></i>`;
                if(isImg) {
                    iconHtml = `<img src="${file.url}" class="preview-img cursor-pointer" onclick="openImagePreview('${file.url}')" loading="lazy"/>`;
                } else if(isVid) {
                    iconHtml = `<i class="ph-fill ph-video-camera text-xl text-pink-400"></i>`;
                } else if(isPdf) {
                    iconHtml = `<i class="ph-fill ph-file-pdf text-xl text-red-400"></i>`;
                }

                const btnId = `dl-${Math.random().toString(36).substr(2, 9)}`;
                const el = document.createElement('div');
                el.className = 'flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5 scale-in';
                el.innerHTML = `
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div class="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden shrink-0">
                            ${iconHtml}
                        </div>
                        <div class="text-left flex flex-col">
                            <div class="text-xs font-bold truncate w-40 md:w-60 text-slate-200" title="${file.name}">${file.name}</div>
                            <div class="text-[10px] text-slate-500 font-mono">${(typeof file.size === 'number' ? (file.size/1024/1024).toFixed(2) : file.size.replace(' MB',''))} MB</div>
                        </div>
                    </div>
                    <button id="${btnId}" onclick="triggerDownload('${file.url}', '${btnId}', '${file.name.replace(/'/g, "\\'")}', '${data.code}')" class="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-white transition-all"><i class="ph-bold ph-download-simple text-xl"></i></button>
                `;
                fragment.appendChild(el);
            });
            list.appendChild(fragment);
            container.appendChild(list);
            
            document.querySelector('#receive-tab .glass-panel').classList.add('hidden');
            
            const resetBtn = document.createElement('button');
            resetBtn.innerText = "Receive Another";
            resetBtn.className = "w-full mt-6 py-3 rounded-xl glass-panel hover:bg-white/10 text-sm font-bold uppercase tracking-widest transition-all text-white";
            resetBtn.onclick = () => {
                container.classList.add('hidden');
                document.querySelector('#receive-tab .glass-panel').classList.remove('hidden');
                document.getElementById('code-input').value = '';
            };
            container.appendChild(resetBtn);
        }
        
        async function downloadAll(files, code) {
            showSnackbar(`Bulk download started (${files.length} files)...`);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const response = await fetch(file.url);
                    const blob = await response.blob();
                    const blobUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = blobUrl; a.download = file.name || `file_${i}`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl);
                    // Prevent browser freezing with a slight delay between downloads
                    await new Promise(resolve => setTimeout(resolve, 300)); 
                } catch (error) { console.error("Failed to download " + file.name, error); }
            }
            showSnackbar('All files downloaded!');
            if (connectedPeerId && currentSessionChannel) {
                currentSessionChannel.send({ type: 'broadcast', event: 'file_downloaded', payload: { code: code } });
            }
        }

        async function triggerDownload(url, btnId, fileName, code) {
            const btn = document.getElementById(btnId); const original = btn ? btn.innerHTML : '';
            if (btn) btn.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>`;
            try {
                const response = await fetch(url); const blob = await response.blob(); const blobUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = blobUrl; a.download = fileName; 
                document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl);
                if (btn) { btn.innerHTML = `<i class="ph-bold ph-check text-xl text-green-400"></i>`; setTimeout(() => { btn.innerHTML = original; }, 2000); }
                
                if (connectedPeerId && currentSessionChannel) {
                    currentSessionChannel.send({ type: 'broadcast', event: 'file_downloaded', payload: { code: code } });
                }
            } catch (error) { console.error("Download Error:", error); showSnackbar("Download failed", "error"); if (btn) btn.innerHTML = original; }
        }

        function verifyGenericPin() {
            const input = document.getElementById('unlock-pin').value;
            if (pendingFileTransfer) {
                if (input === pendingFileTransfer.pin) {
                    const dataToShow = pendingFileTransfer;
                    closePinModal();
                    renderReceivedFiles(dataToShow); 
                } else {
                    showSnackbar('Incorrect PIN', 'error');
                    document.getElementById('unlock-pin').classList.add('border-red-500');
                }
            }
        }
        function closePinModal() {
            document.getElementById('pin-modal').classList.add('hidden');
            document.getElementById('unlock-pin').value = '';
            pendingFileTransfer = null;
        }

        // Live Connect Logic
        function initRealtime() {
            if (!myId || !supabaseClient) return;
            const myChannel = supabaseClient.channel(`room_${myId}`);
            myChannel
            .on('broadcast', { event: 'ping' }, ({ payload }) => {
                const peerChannel = supabaseClient.channel(`room_${payload.from}`);
                peerChannel.subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        peerChannel.send({ type: 'broadcast', event: 'ack', payload: { from: myId } });
                        setupConnectedUI(payload.from);
                        supabaseClient.removeChannel(peerChannel);
                    }
                });
            })
            .on('broadcast', { event: 'ack' }, ({ payload }) => {
                showSnackbar(`Securely linked with ${payload.from}`);
                setupConnectedUI(payload.from);
            })
            .on('broadcast', { event: 'incoming_file' }, ({ payload }) => { handleIncomingInboxItem(payload); })
            .on('broadcast', { event: 'webrtc_signal' }, ({ payload }) => { if (connectedPeerId && payload.from === connectedPeerId) handleWebRTCSignal(payload); })
            .on('broadcast', { event: 'file_downloaded' }, ({ payload }) => { RewardSystem.award('download', payload.code || Date.now().toString()); })
            .on('broadcast', { event: 'disconnect' }, () => { handleDisconnect(true); })
            .subscribe();
        }

        function joinSession() {
            const id = document.getElementById('session-id-input').value.trim();
            if(id.length !== 5) return showSnackbar('Invalid ID (requires 5 digits)', 'error');
            if(!supabaseClient) return showSnackbar('Database not connected', 'error');
            const channel = supabaseClient.channel(`room_${id}`);
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    channel.send({ type: 'broadcast', event: 'ping', payload: { from: myId } });
                    showSnackbar(`Request sent to ${id}`);
                }
            });
        }

        function setupConnectedUI(id) {
            connectedPeerId = id; currentSessionChannel = supabaseClient.channel(`room_${id}`); currentSessionChannel.subscribe();
            document.getElementById('connect-setup').classList.add('hidden'); document.getElementById('connect-room').classList.remove('hidden');
            document.getElementById('room-id-display').innerText = id; document.getElementById('connected-indicator').classList.remove('hidden');
            document.getElementById('connected-peer-id').innerText = id; document.getElementById('btn-text').innerText = "Send to Peer";

            const roomContainer = document.getElementById('room-messages');
            roomContainer.innerHTML = '<div class="text-center text-xs text-slate-500 mt-8 italic p-4 border border-dashed border-white/5 rounded-xl">Messages and files will appear here...<br>Start chatting or click attach to share.</div>';
            
            if (fbDb) {
                chatRoomId = [myId, id].sort().join('_');
                const chatRef = fbRef(fbDb, `live_chats/${chatRoomId}`);
                if (currentChatUnsubscribe) currentChatUnsubscribe(); if (currentTypingUnsubscribe) currentTypingUnsubscribe();
                currentChatUnsubscribe = fbOnChildAdded(chatRef, (snapshot) => renderChatMessage(snapshot.val()));

                const typingRef = fbRef(fbDb, `live_chats_typing/${chatRoomId}/${id}`);
                currentTypingUnsubscribe = fbOnValue(typingRef, (snapshot) => {
                    const isTyping = snapshot.val(); const indicator = document.getElementById('typing-indicator');
                    if (indicator) { indicator.classList.toggle('hidden', !isTyping); if (isTyping) roomContainer.scrollTop = roomContainer.scrollHeight; }
                });
            }
        }

        function leaveSession() { if(currentSessionChannel) currentSessionChannel.unsubscribe(); handleDisconnect(false); }

        function handleDisconnect(remote) {
            if (currentChatUnsubscribe) { currentChatUnsubscribe(); currentChatUnsubscribe = null; }
            if (currentTypingUnsubscribe) { currentTypingUnsubscribe(); currentTypingUnsubscribe = null; }
            cleanupCall(false); chatRoomId = null; connectedPeerId = null;
            document.getElementById('connect-setup').classList.remove('hidden'); document.getElementById('connect-room').classList.add('hidden');
            document.getElementById('connected-indicator').classList.add('hidden'); document.getElementById('btn-text').innerText = "Send Now";
            showSnackbar(remote ? 'Peer disconnected' : 'Session ended', remote ? 'error' : 'info');
        }

        // WebRTC & Chat
        function toggleCall() { isCalling ? cleanupCall(true) : startCall(); }
        async function startCall() {
            try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } 
            catch (err) { return showSnackbar('Mic permission required', 'error'); }
            isCalling = true; updateCallUI();
            peerConnection = new RTCPeerConnection(rtcConfig);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            peerConnection.ontrack = (event) => { document.getElementById('remote-audio').srcObject = event.streams[0]; };
            peerConnection.onicecandidate = (event) => { if (event.candidate) sendWebRTCSignal({ type: 'candidate', candidate: event.candidate }); };
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendWebRTCSignal({ type: 'offer', offer: offer });
            showSnackbar('Calling peer...', 'info');
        }

        function cleanupCall(sendSignal = true) {
            if (!isCalling) return;
            if (peerConnection) { peerConnection.close(); peerConnection = null; }
            if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
            isCalling = false; updateCallUI(); document.getElementById('remote-audio').srcObject = null;
            if (sendSignal) sendWebRTCSignal({ type: 'end_call' });
        }

        function sendWebRTCSignal(payload) { if (currentSessionChannel) currentSessionChannel.send({ type: 'broadcast', event: 'webrtc_signal', payload: { ...payload, from: myId } }); }
        async function handleWebRTCSignal(payload) {
            if (payload.type === 'end_call') { cleanupCall(false); return showSnackbar('Call ended', 'info'); }
            if (payload.type === 'offer') {
                try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } 
                catch (err) { sendWebRTCSignal({ type: 'end_call' }); return showSnackbar('Peer calling but mic permission denied', 'error'); }
                isCalling = true; updateCallUI(); peerConnection = new RTCPeerConnection(rtcConfig);
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
                peerConnection.ontrack = (event) => { document.getElementById('remote-audio').srcObject = event.streams[0]; };
                peerConnection.onicecandidate = (event) => { if (event.candidate) sendWebRTCSignal({ type: 'candidate', candidate: event.candidate }); };
                await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendWebRTCSignal({ type: 'answer', answer: answer });
                showSnackbar('In Call', 'success');
            }
            if (payload.type === 'answer' && peerConnection) { await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer)); showSnackbar('In Call', 'success'); }
            if (payload.type === 'candidate' && peerConnection) { await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
        }

        function updateCallUI() {
            const btn = document.getElementById('btn-call');
            if (!btn) return;
            if (isCalling) { btn.classList.replace('bg-emerald-500/20', 'bg-red-500/20'); btn.classList.replace('text-emerald-400', 'text-red-400'); btn.classList.replace('hover:bg-emerald-500', 'hover:bg-red-500'); btn.classList.replace('border-emerald-500/30', 'border-red-500/30'); btn.innerHTML = `<i class="ph-fill ph-phone-slash text-lg animate-pulse"></i>`; btn.title = "End Call"; } 
            else { btn.classList.replace('bg-red-500/20', 'bg-emerald-500/20'); btn.classList.replace('text-red-400', 'text-emerald-400'); btn.classList.replace('hover:bg-red-500', 'hover:bg-emerald-500'); btn.classList.replace('border-red-500/30', 'border-emerald-500/30'); btn.innerHTML = `<i class="ph-fill ph-phone text-lg"></i>`; btn.title = "Audio Call"; }
        }

        let typingTimeout = null;
        function handleTyping() {
            if (!chatRoomId || !fbDb || !connectedPeerId) return;
            const typingRef = fbRef(fbDb, `live_chats_typing/${chatRoomId}/${myId}`); fbSet(typingRef, true); 
            clearTimeout(typingTimeout); typingTimeout = setTimeout(() => { fbRemove(typingRef); }, 1500);
        }
        function sendChatMessage() {
            const input = document.getElementById('chat-input'); const text = input.value.trim(); if (!text || !chatRoomId || !fbDb) return;
            fbPush(fbRef(fbDb, `live_chats/${chatRoomId}`), { text: text, sender: myId, timestamp: fbServerTimestamp() });
            input.value = ''; fbRemove(fbRef(fbDb, `live_chats_typing/${chatRoomId}/${myId}`)); clearTimeout(typingTimeout);
        }
        function handleChatEnter(e) { if (e.key === 'Enter') sendChatMessage(); }

        function renderChatMessage(data) {
            const container = document.getElementById('room-messages'); if(container.querySelector('.italic')) container.innerHTML = ''; 
            const isMine = data.sender === myId; const msgDiv = document.createElement('div');
            msgDiv.className = `max-w-[85%] md:max-w-[70%] scale-in glass-panel p-3 mb-2 flex flex-col w-max shadow-md ${isMine ? 'ml-auto rounded-2xl rounded-tr-sm bg-indigo-600/30 border-indigo-500/30' : 'mr-auto rounded-2xl rounded-tl-sm bg-emerald-600/30 border-emerald-500/30'}`;
            const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            msgDiv.innerHTML = `<span class="text-sm font-medium text-slate-100 break-words whitespace-pre-wrap">${data.text}</span><span class="text-[9px] text-slate-400 mt-1 ${isMine ? 'text-right' : 'text-left'}">${timeStr}</span>`;
            container.appendChild(msgDiv); container.scrollTop = container.scrollHeight; 
        }

        window.isRoomUploading = false;
        async function handleRoomUpload(input) {
            if (window.isRoomUploading || !supabaseClient) return; const files = Array.from(input.files); if (!files.length) return;
            window.isRoomUploading = true; const container = document.getElementById('room-messages'); if(container.querySelector('.italic')) container.innerHTML = '';
            const sentFiles = [];
            try {
                for (const file of files) {
                    const msgDiv = document.createElement('div'); msgDiv.className = 'ml-auto max-w-[85%] md:max-w-[70%] scale-in glass-panel p-3 rounded-2xl rounded-tr-sm bg-indigo-600/30 border-indigo-500/30 mb-2 w-max shadow-md';
                    msgDiv.innerHTML = `<div class="flex items-center gap-3 text-indigo-200 pr-2"><div class="loader w-4 h-4 border-2 border-indigo-300/30 border-t-indigo-300 shrink-0"></div><span class="text-xs md:text-sm font-bold truncate">${file.name} (Uploading...)</span></div>`;
                    container.appendChild(msgDiv); container.scrollTop = container.scrollHeight;
                    const folder = `live_${connectedPeerId}`; const filePath = `${folder}/${Date.now()}_${file.name}`;
                    const { error } = await supabaseClient.storage.from('uploads').upload(filePath, file);
                    
                    if(!error) {
                        const { data: { publicUrl } } = supabaseClient.storage.from('uploads').getPublicUrl(filePath);
                        const fileMeta = { name: file.name, size: (file.size/1024/1024).toFixed(2)+' MB', type: file.type, url: publicUrl, from: myId };
                        const isImg = file.type && file.type.startsWith('image/');
                        if (isImg) { msgDiv.innerHTML = `<img src="${publicUrl}" loading="lazy" class="w-48 md:w-60 h-auto max-h-48 md:max-h-60 object-cover rounded-xl border border-white/10 cursor-pointer shadow-sm hover:opacity-90 transition-opacity" onclick="openImagePreview('${publicUrl}')" alt="Sent Image"/>`; } 
                        else { msgDiv.innerHTML = `<div class="flex items-center gap-3 pr-2"><div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/5 shadow-inner"><i class="ph-fill ph-file text-indigo-300 text-xl"></i></div><span class="text-sm font-bold truncate text-slate-200">${file.name}</span></div>`; }
                        currentSessionChannel.send({ type: 'broadcast', event: 'incoming_file', payload: fileMeta });
                        sentFiles.push(fileMeta);
                    } else { msgDiv.innerHTML = `<span class="text-xs text-red-400">Upload failed: ${file.name}</span>`; }
                }
                if (sentFiles.length > 0) { addToActivity({ type: 'direct_sent', peer: connectedPeerId, files: sentFiles, date: new Date().toLocaleString() }); RewardSystem.award('upload', Date.now().toString()); }
            } finally { input.value = ''; window.isRoomUploading = false; }
        }

        function handleIncomingInboxItem(payload) {
            if (connectedPeerId === payload.from && !document.getElementById('connect-room').classList.contains('hidden')) {
                const container = document.getElementById('room-messages');
                if(container.querySelector('.italic')) container.innerHTML = '';
                const msgDiv = document.createElement('div');
                msgDiv.className = 'mr-auto max-w-[85%] md:max-w-[70%] scale-in glass-panel p-3 rounded-2xl rounded-tl-sm bg-emerald-600/30 border-emerald-500/30 mb-2 w-max shadow-md';
                const isImg = payload.type && payload.type.startsWith('image/');
                const btnId = `rm-dl-${Math.random().toString(36).substr(2, 9)}`;
                const safeFileName = (payload.name || 'file').replace(/'/g, "\\'");

                if (isImg) { msgDiv.innerHTML = `<div class="flex items-end gap-2"><img src="${payload.url}" loading="lazy" class="w-48 md:w-60 h-auto max-h-48 md:max-h-60 object-cover rounded-xl border border-white/10 cursor-pointer shadow-sm hover:opacity-90 transition-opacity" onclick="openImagePreview('${payload.url}')" alt="Shared Image"><button id="${btnId}" onclick="triggerDownload('${payload.url}', '${btnId}', '${safeFileName}')" class="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-all shrink-0 mb-1" title="Download Image"><i class="ph-bold ph-download-simple text-xl"></i></button></div>`; } 
                else { msgDiv.innerHTML = `<div class="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 rounded-xl transition-colors pr-2" onclick="triggerDownload('${payload.url}', '${btnId}', '${safeFileName}')"><div id="${btnId}" class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/5 shadow-inner"><i class="ph-fill ph-download-simple text-emerald-300 text-lg"></i></div><span class="text-sm font-bold truncate text-slate-200">${payload.name || 'File'}</span></div>`; }
                container.appendChild(msgDiv); container.scrollTop = container.scrollHeight;
            }
            inboxCount++; updateInboxBadges(true); showSnackbar('New Data Received!');
            const list = document.getElementById('inbox-list'); if(list.querySelector('.italic')) list.innerHTML = '';
            const div = document.createElement('div'); div.className = 'glass-panel p-4 rounded-xl flex items-center justify-between scale-in border-l-4 border-l-emerald-500 mb-2';
            if (payload.type === 'message') { div.innerHTML = `<div class="flex flex-col w-full text-left"><span class="text-[10px] font-black uppercase text-emerald-400 tracking-widest mb-1">Direct Note</span><div class="text-sm text-slate-200 select-text mb-1">"${payload.content}"</div><div class="text-[9px] text-slate-500 text-right">From ${payload.from}</div></div>`; } 
            else {
                const isImg = payload.type && payload.type.startsWith('image/'); const btnId = `ibx-${Math.random().toString(36).substr(2, 9)}`; const safeFileName = (payload.name || 'file').replace(/'/g, "\\'");
                div.innerHTML = `<div class="flex items-center gap-3 overflow-hidden"><div class="w-12 h-12 rounded-xl bg-black/30 flex items-center justify-center overflow-hidden shrink-0 border border-white/5">${isImg ? `<img src="${payload.url}" class="preview-img cursor-pointer" onclick="openImagePreview('${payload.url}')" loading="lazy"/>` : '<i class="ph-fill ph-file text-2xl text-emerald-400"></i>'}</div><div class="flex flex-col overflow-hidden text-left"><span class="truncate text-sm font-bold text-slate-200">${payload.name}</span><div class="flex items-center gap-2"><span class="text-[10px] font-black bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded uppercase">Peer</span><span class="text-[10px] text-slate-500 font-mono">${payload.size}</span></div></div></div><button id="${btnId}" onclick="triggerDownload('${payload.url}', '${btnId}', '${safeFileName}')" class="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"><i class="ph-bold ph-download-simple text-xl"></i></button>`;
            }
            list.prepend(div);
            if (payload.type !== 'message') { addToActivity({ type: 'direct_received', peer: payload.from, files: [payload], date: new Date().toLocaleString() }); }
        }

        function updateInboxBadges(show) {
            const badges = [document.getElementById('desktop-inbox-badge'), document.getElementById('mobile-inbox-badge')];
            badges.forEach(b => show ? b.classList.remove('hidden') : b.classList.add('hidden'));
        }

        function clearInbox() { 
            document.getElementById('inbox-list').innerHTML = `<div class="text-center text-slate-600 text-sm mt-20 italic flex flex-col items-center"><i class="ph-duotone ph-tray-open text-5xl mb-4 opacity-50"></i>Inbox cleared.</div>`; 
            inboxCount = 0; updateInboxBadges(false); 
        }

        // Activity Log
        function addToActivity(data) {
            const activity = JSON.parse(localStorage.getItem('flux_activity') || '[]');
            activity.unshift(data); localStorage.setItem('flux_activity', JSON.stringify(activity.slice(0, 30)));
            renderActivity();
        }

        function renderActivity() {
            const list = document.getElementById('activity-list'); const activity = JSON.parse(localStorage.getItem('flux_activity') || '[]');
            list.innerHTML = ''; if(activity.length === 0) { list.innerHTML = '<div class="text-center text-slate-600 text-sm mt-12 italic">No activity yet</div>'; return; }
            activity.forEach(item => {
                const div = document.createElement('div');
                div.className = 'glass-panel p-4 rounded-xl flex flex-col gap-2 scale-in border-l-4 ' + (item.type.includes('sent') || item.type === 'upload' ? 'border-l-indigo-500' : 'border-l-emerald-500');
                let header = '', content = '';
                if (item.type === 'upload') {
                    header = `<div class="flex justify-between items-center"><span class="text-[10px] font-black uppercase text-indigo-400">Sent via Code</span><span class="text-[9px] text-slate-500">${item.date}</span></div>`;
                    content = `<div class="flex justify-between items-center mt-1"><div class="font-mono text-xl font-bold text-white tracking-widest">${item.code}</div><div class="text-xs text-slate-400">${item.files.length} Files</div></div>`;
                } else if (item.type === 'download') {
                    header = `<div class="flex justify-between items-center"><span class="text-[10px] font-black uppercase text-emerald-400">Received via Code</span><span class="text-[9px] text-slate-500">${item.date}</span></div>`;
                    content = `<div class="flex justify-between items-center mt-1"><div class="font-mono text-xl font-bold text-white tracking-widest line-through decoration-slate-600">${item.code}</div><div class="text-xs text-slate-400">${item.files.length} Files</div></div>`;
                } else if (item.type === 'direct_sent') {
                    header = `<div class="flex justify-between items-center"><span class="text-[10px] font-black uppercase text-indigo-400">Direct to Peer ${item.peer}</span><span class="text-[9px] text-slate-500">${item.date}</span></div>`;
                    content = `<div class="mt-1 flex flex-col gap-1">${item.files.map(f => `<div class="text-xs text-slate-300 truncate"><i class="ph-bold ph-arrow-right text-indigo-500 mr-1"></i>${f.name}</div>`).join('')}</div>`;
                } else if (item.type === 'direct_received') {
                    header = `<div class="flex justify-between items-center"><span class="text-[10px] font-black uppercase text-emerald-400">Direct from Peer ${item.peer}</span><span class="text-[9px] text-slate-500">${item.date}</span></div>`;
                    content = `<div class="mt-1 flex flex-col gap-1">${item.files.map(f => `<div class="text-xs text-slate-300 truncate"><i class="ph-bold ph-arrow-down-left text-emerald-500 mr-1"></i>${f.name}</div>`).join('')}</div>`;
                }
                div.innerHTML = header + content; list.appendChild(div);
            });
        }
        function clearHistory() { localStorage.removeItem('flux_activity'); renderActivity(); updateLastCodeUI(); }

        // Settings / Info Modals
        function kpkpOpen(el){
            var id = el.getAttribute("data-id");
            document.getElementById("kpkpcontent").innerHTML = document.getElementById(id).innerHTML;
            document.getElementById("kpkpmodal").style.display = "flex";
        }
        function kpkpClose(){ document.getElementById("kpkpmodal").style.display = "none"; }

        function showAboutAkpf() {
            Swal.fire({
                html: document.getElementById("aboutDataAkpf").innerHTML,
                showConfirmButton: false,
                showCloseButton: true,
                background: '#1e293b',
                color: '#fff',
                customClass: { popup: 'swal2-popup-akpf' }
            });
        }
        
        function clearCookiesAndReload() {
            Swal.fire({
                title: "Are you sure?",
                text: "Do you want to clear all app data?",
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Yes, delete it!'
            }).then((result) => {
                if (result.isConfirmed) {
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.reload();
                }
            });
        }

        function feedbackhere() {
            Swal.fire({
                title: 'Feedback',
                html: `
                    <input id="swal-input1" class="swal2-input" placeholder="Your Email">
                    <textarea id="swal-input2" class="swal2-textarea" placeholder="Your Message"></textarea>
                `,
                focusConfirm: false,
                confirmButtonText: 'Send',
                background: '#1e293b',
                color: '#fff',
                preConfirm: () => {
                    showSnackbar("Thank you for your feedback!");
                }
            });
        }

        // Image Preview logic
        function openImagePreview(url) {
            const modal = document.getElementById('image-preview-modal');
            const img = document.getElementById('preview-modal-img');
            img.src = url;
            modal.classList.remove('hidden');
            setTimeout(() => { modal.classList.remove('opacity-0'); img.classList.remove('scale-95'); img.classList.add('scale-100'); }, 10);
        }
        function closeImagePreview() {
            const modal = document.getElementById('image-preview-modal');
            const img = document.getElementById('preview-modal-img');
            modal.classList.add('opacity-0');
            img.classList.remove('scale-100'); img.classList.add('scale-95');
            setTimeout(() => { modal.classList.add('hidden'); img.src = ''; }, 300);
        }
        
        // AI Logic
        function closeAiModal() {
            const modal = document.getElementById('ai-modal');
            modal.classList.add('opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }

        // Scanner Handlers
        function openScanner() {
            const modal = document.getElementById('scanner-modal');
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0'), 10);
            
            html5QrCode = new Html5Qrcode("reader");
            html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess)
                .catch(err => { showSnackbar("Camera permission denied.", "error"); closeScanner(); });
        }
        function closeScanner() {
            const modal = document.getElementById('scanner-modal');
            modal.classList.add('opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 300);
            if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => html5QrCode.clear()); }
        }
        function onScanSuccess(decodedText) {
            closeScanner();
            if (/^\d{5}$/.test(decodedText) || decodedText.includes("?code=")) {
                const code = decodedText.includes("?code=") ? new URL(decodedText).searchParams.get("code") : decodedText;
                document.getElementById('code-input').value = code;
                fetchFiles();
            } else { showSnackbar("Invalid QR Code Format", "error"); }
        }

        // Setup Network listeners
        window.addEventListener('online', () => { document.getElementById('offline-banner').classList.add('hidden'); showSnackbar('Back Online!', 'success'); });
        window.addEventListener('offline', () => { document.getElementById('offline-banner').classList.remove('hidden'); showSnackbar('You are offline.', 'error'); });

        // Swipe Gestures
        document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
        document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipeGesture(); }, false);

        function toggleSwipe(enabled) { localStorage.setItem('flux_swipe', enabled); }
        function handleSwipeGesture() {
            if (localStorage.getItem('flux_swipe') === 'false') return;
            const limit = 50; 
            let activeTabId = '';
            document.querySelectorAll('.tab-content').forEach(el => { if(!el.classList.contains('hidden')) activeTabId = el.id.replace('-tab',''); });
            const currentIndex = tabOrder.indexOf(activeTabId);
            if (touchEndX < touchStartX - limit && currentIndex < tabOrder.length - 1) switchTab(tabOrder[currentIndex + 1]);
            if (touchEndX > touchStartX + limit && currentIndex > 0) switchTab(tabOrder[currentIndex - 1]);
        }

        // Init routine
        document.addEventListener('DOMContentLoaded', () => {
            initAuth();
            renderActivity();
            const urlParams = new URLSearchParams(window.location.search);
            if(urlParams.get('code')) {
                switchTab('receive');
                document.getElementById('code-input').value = urlParams.get('code');
                setTimeout(fetchFiles, 500);
            }
            if(!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');
        });

        window.addEventListener("keydown", function(e){
            if(e.shiftKey){
                if(e.key.toLowerCase() === "x") { e.preventDefault(); document.getElementById("fileInput").click(); }
                if(e.key.toLowerCase() === "d") { e.preventDefault(); removeAllFiles(); }
                if(e.key.toLowerCase() === "e") { e.preventDefault(); startUpload(); }
            }
        });
    </script>
