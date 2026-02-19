let currentOrder = null;
let checkInterval = null;
let currentPrice = 0;
let currentPanelType = '';
let currentEmail = '';

// Panel data dari window.CONFIG
const panelData = [
    { type: '1gb', ram: '1GB', disk: '1GB', cpu: '40%', price: window.CONFIG.PRICE_1GB },
    { type: '2gb', ram: '2GB', disk: '2GB', cpu: '60%', price: window.CONFIG.PRICE_2GB },
    { type: '3gb', ram: '3GB', disk: '3GB', cpu: '80%', price: window.CONFIG.PRICE_3GB },
    { type: '4gb', ram: '4GB', disk: '4GB', cpu: '100%', price: window.CONFIG.PRICE_4GB },
    { type: '5gb', ram: '5GB', disk: '5GB', cpu: '120%', price: window.CONFIG.PRICE_5GB },
    { type: '6gb', ram: '6GB', disk: '6GB', cpu: '140%', price: window.CONFIG.PRICE_6GB },
    { type: '7gb', ram: '7GB', disk: '7GB', cpu: '160%', price: window.CONFIG.PRICE_7GB },
    { type: '8gb', ram: '8GB', disk: '8GB', cpu: '180%', price: window.CONFIG.PRICE_8GB },
    { type: '9gb', ram: '9GB', disk: '9GB', cpu: '200%', price: window.CONFIG.PRICE_9GB },
    { type: '10gb', ram: '10GB', disk: '10GB', cpu: '220%', price: window.CONFIG.PRICE_10GB },
    { type: 'unli', ram: 'Unlimited', disk: 'Unlimited', cpu: 'Unlimited', price: window.CONFIG.PRICE_UNLI }
];

// Slider variables
let currentSlide = 0;
let slideInterval;
const SWIPE_THRESHOLD = 80;

// DOM elements
const sliderContainer = document.getElementById('newsSlider');
const sliderTrack = document.querySelector('.slider-track');

// ==================== VISIT TRACKING ====================
async function trackVisit() {
    try {
        await fetch('/api/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                referrer: document.referrer || 'Langsung',
                userAgent: navigator.userAgent,
                screen: `${window.screen.width}x${window.screen.height}`,
                language: navigator.language,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })
        });
    } catch (error) {
        console.error('Gagal mengirim kunjungan', error);
    }
}

// ==================== SLIDER FUNCTIONS ====================
function startSlider() {
    clearInterval(slideInterval);
    slideInterval = setInterval(nextSlide, 5000);
}

function nextSlide() {
    currentSlide = (currentSlide + 1) % 2;
    updateSlider();
}

function previousSlide() {
    currentSlide = (currentSlide - 1 + 2) % 2;
    updateSlider();
}

function updateSlider() {
    if (sliderTrack) {
        const translateX = -currentSlide * 50;
        sliderTrack.style.transform = `translateX(${translateX}%)`;
    }
}

function setupSlider() {
    if (!sliderContainer || !sliderTrack) return;

    let isSwiping = false;
    let startX = 0;
    let currentX = 0;

    function getPositionX(e) {
        return e.type.includes('mouse') ? e.pageX : e.touches[0].clientX;
    }

    // Touch events
    sliderContainer.addEventListener('touchstart', (e) => {
        startX = getPositionX(e);
        isSwiping = true;
        clearInterval(slideInterval);
    });

    sliderContainer.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        currentX = getPositionX(e);
        const diff = currentX - startX;
        if (Math.abs(diff) > 20) {
            const translateX = -currentSlide * 50 + (diff / sliderContainer.offsetWidth) * 50;
            sliderTrack.style.transform = `translateX(${translateX}%)`;
        }
    });

    sliderContainer.addEventListener('touchend', () => {
        if (!isSwiping) return;
        isSwiping = false;
        const diff = currentX - startX;
        if (Math.abs(diff) > SWIPE_THRESHOLD) {
            if (diff > 0) previousSlide();
            else nextSlide();
        } else {
            updateSlider();
        }
        startSlider();
    });

    // Mouse events
    sliderContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = getPositionX(e);
        isSwiping = true;
        clearInterval(slideInterval);
        sliderContainer.style.cursor = 'grabbing';
    });

    sliderContainer.addEventListener('mousemove', (e) => {
        if (!isSwiping) return;
        e.preventDefault();
        currentX = getPositionX(e);
        const diff = currentX - startX;
        if (Math.abs(diff) > 20) {
            const translateX = -currentSlide * 50 + (diff / sliderContainer.offsetWidth) * 50;
            sliderTrack.style.transform = `translateX(${translateX}%)`;
        }
    });

    sliderContainer.addEventListener('mouseup', () => {
        if (!isSwiping) return;
        isSwiping = false;
        sliderContainer.style.cursor = 'grab';
        const diff = currentX - startX;
        if (Math.abs(diff) > SWIPE_THRESHOLD) {
            if (diff > 0) previousSlide();
            else nextSlide();
        } else {
            updateSlider();
        }
        startSlider();
    });

    sliderContainer.addEventListener('mouseleave', () => {
        if (isSwiping) {
            isSwiping = false;
            sliderContainer.style.cursor = 'grab';
            updateSlider();
            startSlider();
        }
    });
}

// ==================== PRICING CARDS ====================
function generatePriceCards() {
    const grid = document.getElementById('pricingGrid');
    let html = '';
    panelData.forEach(panel => {
        html += `
        <div class="price-card">
            <div class="panel-type">${panel.type.toUpperCase()}</div>
            <div class="panel-specs">
                <div><i class="fas fa-memory"></i> RAM: ${panel.ram}</div>
                <div><i class="fas fa-hdd"></i> DISK: ${panel.disk}</div>
                <div><i class="fas fa-microchip"></i> CPU: ${panel.cpu}</div>
            </div>
            <div class="price">Rp ${panel.price.toLocaleString('id-ID')}</div>
            <button class="yoshi-btn" onclick="openEmailModal('${panel.type}', ${panel.price})">
                <i class="fas fa-shopping-cart"></i> BELI SEKARANG
            </button>
        </div>
        `;
    });
    grid.innerHTML = html;
}

// ==================== EMAIL MODAL ====================
function openEmailModal(panelType, price) {
    currentPanelType = panelType;
    currentPrice = price;
    document.getElementById('emailModal').style.display = 'flex';
    document.getElementById('userEmail').focus();
}

function closeEmailModal() {
    document.getElementById('emailModal').style.display = 'none';
    document.getElementById('userEmail').value = '';
}

async function submitEmail() {
    const emailInput = document.getElementById('userEmail');
    const email = emailInput.value.trim();
    if (!email || !email.includes('@') || !email.includes('.')) {
        alert('Masukkan email yang valid!');
        emailInput.focus();
        return;
    }
    currentEmail = email;
    closeEmailModal();
    await createOrder(email, currentPanelType, currentPrice);
}

// ==================== ORDER & PAYMENT ====================
async function createOrder(email, panelType, price) {
    try {
        const response = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, panel_type: panelType })
        });
        const data = await response.json();
        if (data.success) {
            currentOrder = data.order;
            showPaymentModal(data, email, panelType);
            startPaymentCheck(data.order.order_id, email, panelType);
        } else {
            alert(data.message || 'Gagal membuat order');
        }
    } catch (error) {
        alert('Terjadi kesalahan, silahkan coba lagi');
    }
}

function showPaymentModal(data, email, panelType) {
    const modal = document.getElementById('paymentModal');
    const details = document.getElementById('paymentDetails');
    let html = `
        <div style="text-align: left; margin-bottom: 20px;">
            <div style="margin-bottom: 10px;">
                <strong>Order ID:</strong><br>
                <span style="color: var(--text-sub); font-family: monospace;">${data.order.order_id}</span>
            </div>
            <div style="margin-bottom: 10px;">
                <strong>Email:</strong><br>
                <span style="color: var(--text-sub);">${email}</span>
            </div>
            <div style="margin-bottom: 10px;">
                <strong>Panel Type:</strong><br>
                <span style="color: var(--accent-gold);">${panelType.toUpperCase()}</span>
            </div>
            <div style="margin-bottom: 10px;">
                <strong>Total Pembayaran:</strong><br>
                <span style="font-size: 1.5rem; color: var(--accent-gold);">
                    Rp ${currentPrice.toLocaleString('id-ID')}
                </span>
            </div>
        </div>
        <div class="qr-container">
            <img src="${data.qr_url}" alt="QR Code">
        </div>
        ${data.order.qris_string ? `
        <div style="margin: 15px 0;">
            <div><strong>QRIS String:</strong></div>
            <div class="payment-info">${data.order.qris_string}</div>
            <small style="color: var(--text-sub);">Scan dengan aplikasi e-wallet Anda</small>
        </div>
        ` : ''}
        <div id="paymentStatus" class="status-message pending">
            <i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...
        </div>
    `;
    details.innerHTML = html;
    modal.style.display = 'flex';
}

async function manualCheckStatus() {
    if (!currentOrder) return;
    const btn = document.getElementById('checkStatusBtn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memeriksa...';
    btn.disabled = true;
    await checkPaymentStatus(currentOrder.order_id, currentEmail, currentPanelType);
    setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }, 1000);
}

function startPaymentCheck(orderId, email, panelType) {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(async () => {
        await checkPaymentStatus(orderId, email, panelType);
    }, 3000);
}

async function checkPaymentStatus(orderId, email, panelType) {
    try {
        const response = await fetch('/api/check-payment/' + orderId);
        const data = await response.json();
        if (data.success) {
            const statusDiv = document.getElementById('paymentStatus');
            const btn = document.getElementById('checkStatusBtn');
            const paidStatuses = ['paid', 'success', 'settled'];
            if (paidStatuses.includes(data.status)) {
                statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Pembayaran berhasil! Panel sedang dibuat...';
                statusDiv.className = 'status-message success';
                btn.style.background = 'linear-gradient(90deg, #10b981, #059669)';
                btn.innerHTML = '<i class="fas fa-check"></i> Berhasil';
                clearInterval(checkInterval);
                setTimeout(async () => {
                    try {
                        const panelResponse = await fetch('/api/create-panel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order_id: orderId, email, panel_type: panelType })
                        });
                        const panelData = await panelResponse.json();
                        if (panelData.success) {
                            statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Panel berhasil dibuat!';
                            alert(`✅ Panel berhasil dibuat!\n\n📧 Email: ${email}\n📦 Panel: ${panelType.toUpperCase()}\n🆔 Order ID: ${orderId}\n\nSilahkan cek email untuk informasi lebih lanjut.`);
                        } else {
                            statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Gagal membuat panel: ' + panelData.message;
                            statusDiv.className = 'status-message error';
                        }
                    } catch (panelError) {
                        statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error membuat panel';
                        statusDiv.className = 'status-message error';
                    }
                }, 2000);
            } else if (data.status === 'expired') {
                statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Pembayaran kadaluarsa';
                statusDiv.className = 'status-message error';
                btn.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
                btn.innerHTML = '<i class="fas fa-times"></i> Gagal';
                clearInterval(checkInterval);
            } else if (data.status === 'pending') {
                statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...';
                statusDiv.className = 'status-message pending';
            }
        }
    } catch (error) {
        // silent
    }
}

function closeModal() {
    document.getElementById('paymentModal').style.display = 'none';
    if (checkInterval) clearInterval(checkInterval);
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    generatePriceCards();
    setupSlider();   // <-- slider dipasang di sini
    startSlider();   // <-- autoplay dimulai
    trackVisit();

    // Auto-play video
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        video.play().catch(e => {});
    });

    // Enter key untuk email modal
    document.getElementById('userEmail')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') submitEmail();
    });
});

// Prevent right-click & dev tools (opsional)
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I') || (e.ctrlKey && e.key === 'U')) {
        e.preventDefault();
    }
});