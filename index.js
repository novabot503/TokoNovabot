const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./setting.js');

// Inisialisasi aplikasi
const app = express();
const PORT = config.PORT || 3000;
const HOST = config.HOST || 'localhost';

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Path untuk file data
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(__dirname, 'setting.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PANELS_FILE = path.join(DATA_DIR, 'panels.json');

// Inisialisasi file data
function initializeDataFiles() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Buat setting.json jika belum ada
    if (!fs.existsSync(SETTINGS_FILE)) {
        const defaultSettings = {
            nama_toko: "NovaBot Panel",
            deskripsi: "Jual Panel Pterodactyl Murah & Terpercaya",
            foto_profil: "",
            video_promo: "",
            logo_url: "",
            warna_utama: "#3a6df0",
            harga_panel: {
                "1gb": 0,
                "2gb": 0,
                "3gb": 0,
                "4gb": 0,
                "5gb": 0,
                "6gb": 0,
                "7gb": 0,
                "8gb": 0,
                "9gb": 0,
                "10gb": 0,
                "unli": 0
            },
            telegram_admin: "@Novabot403",
            whatsapp_admin: "",
            pesan_selamat_datang: "Selamat datang di NovaBot Panel!",
            footer_text: "© 2024 NovaBot Panel - All rights reserved"
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 4));
        console.log('📁 setting.json created with default values');
    }

    // Buat file data lainnya
    const defaultFiles = {
        [USERS_FILE]: [],
        [ORDERS_FILE]: [],
        [PANELS_FILE]: []
    };

    Object.entries(defaultFiles).forEach(([filePath, defaultValue]) => {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 4));
        }
    });
}

// Panggil inisialisasi
initializeDataFiles();

// Fungsi baca/tulis data
function readJSON(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return null;
    }
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

// Load settings
function getSettings() {
    return readJSON(SETTINGS_FILE) || {};
}

function saveSettings(settings) {
    return writeJSON(SETTINGS_FILE, settings);
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 PAKASIR PAYMENT FUNCTIONS
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createQRISPayment(orderId, amount) {
    try {
        const response = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                project: config.PAKASIR_PROJECT,
                api_key: config.PAKASIR_API_KEY,
                order_id: orderId,
                amount: amount
            })
        });
        
        const data = await response.json();
        console.log('Pakasir Response:', data);

        if (!data.success && !data.payment) {
            return null;
        }

        const payment = data.payment || data;
        return {
            success: true,
            payment_number: payment.payment_number || payment.code || '',
            qris_string: payment.payment_number || payment.qris_string || '',
            raw: data
        };
    } catch (error) {
        console.error('Error creating QRIS payment:', error);
        return null;
    }
}

async function checkPaymentStatus(orderId) {
    try {
        const detailUrl = `https://app.pakasir.com/api/transactiondetail?project=${encodeURIComponent(config.PAKASIR_PROJECT)}&amount=0&order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(config.PAKASIR_API_KEY)}`;
        const response = await fetch(detailUrl);
        const data = await response.json();
        const transaction = data.transaction || data || {};
        
        return {
            success: true,
            status: transaction.status || '',
            transaction: transaction,
            raw: data
        };
    } catch (error) {
        console.error('Error checking payment status:', error);
        return null;
    }
}

async function processPayment(orderId, amount, description = 'Pembayaran Panel') {
    try {
        const qrData = await createQRISPayment(orderId, amount);
        if (!qrData) {
            throw new Error('Gagal membuat pembayaran QRIS');
        }
        return qrData;
    } catch (error) {
        console.error('Error processing payment:', error);
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ QR CODE GENERATION
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function generateQRCode(text) {
    try {
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=500&margin=1`;
        const response = await fetch(qrUrl);
        const buffer = await response.buffer();
        return buffer;
    } catch (error) {
        console.error('Error generating QR code:', error);
        return null;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖥️ CREATE PTERODACTYL SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createPterodactylServer(userId, panelType, username, serverName = null) {
    try {
        let ram, disk, cpu;
        const settings = getSettings();
        const hargaPanel = settings.harga_panel || {};
        
        if (panelType === 'unli' || panelType === 'unlimited') {
            ram = 0;
            disk = 0;
            cpu = 0;
        } else {
            switch (panelType) {
                case '1gb': ram = 1024; disk = 1024; cpu = 40; break;
                case '2gb': ram = 2048; disk = 2048; cpu = 60; break;
                case '3gb': ram = 3072; disk = 3072; cpu = 80; break;
                case '4gb': ram = 4096; disk = 4096; cpu = 100; break;
                case '5gb': ram = 5120; disk = 5120; cpu = 120; break;
                case '6gb': ram = 6144; disk = 6144; cpu = 140; break;
                case '7gb': ram = 7168; disk = 7168; cpu = 160; break;
                case '8gb': ram = 8192; disk = 8192; cpu = 180; break;
                case '9gb': ram = 9216; disk = 9216; cpu = 200; break;
                case '10gb': ram = 10240; disk = 10240; cpu = 220; break;
                default: ram = 1024; disk = 1024; cpu = 40;
            }
        }

        const serverCount = 1;
        const safeServerName = serverName || 
            (panelType === 'unli' || panelType === 'unlimited' 
                ? `${capitalize(username)} UNLI Server #${serverCount}`
                : `${capitalize(username)} ${panelType.toUpperCase()} Server #${serverCount}`);

        const serverResponse = await fetch(`${config.DOMAIN}/api/application/servers`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.PLTA}`
            },
            body: JSON.stringify({
                name: safeServerName,
                description: '',
                user: userId,
                egg: parseInt(config.EGG),
                docker_image: 'ghcr.io/parkervcp/yolks:nodejs_20',
                startup: 'npm install && npm start',
                environment: {
                    INST: 'npm',
                    USER_UPLOAD: '0',
                    AUTO_UPDATE: '0',
                    CMD_RUN: 'npm start'
                },
                limits: {
                    memory: parseInt(ram),
                    swap: 0,
                    disk: parseInt(disk),
                    io: 500,
                    cpu: parseInt(cpu)
                },
                feature_limits: {
                    databases: 5,
                    backups: 5,
                    allocations: 1
                },
                deploy: {
                    locations: [parseInt(config.LOX)],
                    dedicated_ip: false,
                    port_range: []
                }
            })
        });

        const serverData = await serverResponse.json();
        
        if (serverData.errors) {
            if (serverData.errors[0].detail && serverData.errors[0].detail.includes('Too Many Attempts')) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                // Retry logic...
                // (Kode retry yang sama seperti sebelumnya)
            } else {
                throw new Error(serverData.errors[0].detail);
            }
        }

        // Simpan ke database panels
        const panels = readJSON(PANELS_FILE) || [];
        const newPanel = {
            id: `panel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId: userId,
            username: username,
            serverId: serverData.attributes.id,
            name: safeServerName,
            panelType: panelType,
            ram: ram,
            disk: disk,
            cpu: cpu,
            status: 'active',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 hari
        };
        
        panels.push(newPanel);
        writeJSON(PANELS_FILE, panels);

        return {
            success: true,
            panel: newPanel,
            server: serverData.attributes
        };
    } catch (error) {
        console.error('Error creating Pterodactyl server:', error);
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 HELPER FUNCTIONS
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

function generateOrderId() {
    return `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 ROUTES API
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. GET Settings
app.get('/api/settings', (req, res) => {
    const settings = getSettings();
    res.json({
        success: true,
        settings: settings,
        config: {
            versi_web: config.VERSI_WEB,
            developer: config.DEVELOPER,
            nama_tokoh: config.NAMA_TOKOH
        }
    });
});

// 2. UPDATE Settings (Admin only)
app.post('/api/admin/settings', (req, res) => {
    const { password, ...newSettings } = req.body;
    
    // Simple admin auth
    if (password !== "admin123") {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const currentSettings = getSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    
    if (saveSettings(updatedSettings)) {
        res.json({ success: true, message: 'Settings updated' });
    } else {
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// 3. GET Harga Panel
app.get('/api/prices', (req, res) => {
    const settings = getSettings();
    res.json({
        success: true,
        prices: settings.harga_panel || {}
    });
});

// 4. CREATE Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { email, panel_type } = req.body;
        
        if (!email || !panel_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email dan tipe panel harus diisi' 
            });
        }

        const settings = getSettings();
        const hargaPanel = settings.harga_panel || {};
        const amount = hargaPanel[panel_type] || 0;

        if (amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Harga panel belum diatur oleh admin' 
            });
        }

        const orderId = generateOrderId();
        
        // Buat pembayaran
        const payment = await processPayment(orderId, amount);
        
        if (!payment) {
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal membuat pembayaran' 
            });
        }

        // Simpan order
        const orders = readJSON(ORDERS_FILE) || [];
        const newOrder = {
            order_id: orderId,
            email: email,
            panel_type: panel_type,
            amount: amount,
            payment_number: payment.payment_number,
            status: 'pending',
            created_at: new Date().toISOString(),
            qris_string: payment.qris_string
        };
        
        orders.push(newOrder);
        writeJSON(ORDERS_FILE, orders);

        // Generate QR Code
        const qrBuffer = await generateQRCode(payment.qris_string);
        const qrBase64 = qrBuffer ? qrBuffer.toString('base64') : null;

        res.json({
            success: true,
            order: newOrder,
            qr_code: qrBase64 ? `data:image/png;base64,${qrBase64}` : null,
            payment_info: payment
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 5. CHECK Payment Status
app.get('/api/check-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const paymentStatus = await checkPaymentStatus(orderId);
        
        if (!paymentStatus) {
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal memeriksa status pembayaran' 
            });
        }

        // Update order status
        const orders = readJSON(ORDERS_FILE) || [];
        const orderIndex = orders.findIndex(o => o.order_id === orderId);
        
        if (orderIndex !== -1) {
            const order = orders[orderIndex];
            
            if (paymentStatus.status === 'PAID' && order.status !== 'completed') {
                // Proses pembuatan panel
                try {
                    const panelResult = await createPterodactylServer(
                        'user_' + Date.now(), // Ini harus diganti dengan userId yang sesungguhnya
                        order.panel_type,
                        order.email.split('@')[0]
                    );

                    if (panelResult.success) {
                        orders[orderIndex].status = 'completed';
                        orders[orderIndex].panel_id = panelResult.panel.id;
                        orders[orderIndex].completed_at = new Date().toISOString();
                        
                        writeJSON(ORDERS_FILE, orders);

                        // Kirim notifikasi ke Telegram
                        const telegramMsg = `✅ *PEMBAYARAN BERHASIL*
Order ID: ${orderId}
Email: ${order.email}
Panel: ${order.panel_type.toUpperCase()}
Amount: Rp ${order.amount}
Server ID: ${panelResult.panel.serverId}`;

                        sendTelegramNotification(telegramMsg);
                    }
                } catch (panelError) {
                    console.error('Error creating panel:', panelError);
                }
            }
            
            orders[orderIndex].last_checked = new Date().toISOString();
            writeJSON(ORDERS_FILE, orders);
        }

        res.json({
            success: true,
            status: paymentStatus.status,
            order: orderIndex !== -1 ? orders[orderIndex] : null
        });

    } catch (error) {
        console.error('Error checking payment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 6. GET Orders (Admin)
app.get('/api/admin/orders', (req, res) => {
    const { password } = req.query;
    
    if (password !== "admin123") {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const orders = readJSON(ORDERS_FILE) || [];
    res.json({ success: true, orders });
});

// 7. GET Panels (Admin)
app.get('/api/admin/panels', (req, res) => {
    const { password } = req.query;
    
    if (password !== "admin123") {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const panels = readJSON(PANELS_FILE) || [];
    res.json({ success: true, panels });
});

// 8. Telegram Notification
async function sendTelegramNotification(message) {
    try {
        const url = `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.OWNER_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 ROUTE UTAMA (HTML)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (req, res) => {
    const settings = getSettings();
    const html = generateHomePage(settings);
    res.send(html);
});

app.get('/admin', (req, res) => {
    const html = generateAdminPage();
    res.send(html);
});

function generateHomePage(settings) {
    return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${settings.nama_toko || 'NovaBot Panel'}</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            :root {
                --bg-main: #02040a;
                --bg-card: #0b0f19;
                --primary: ${settings.warna_utama || '#3a6df0'};
                --accent: #ffcc00;
                --text-main: #ffffff;
                --text-sub: #8b9bb4;
                --border-color: #1c2538;
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                font-family: 'Rajdhani', sans-serif;
            }

            body {
                background: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }

            .header {
                text-align: center;
                padding: 40px 20px;
                background: linear-gradient(135deg, var(--primary), #2a5298);
                border-radius: 20px;
                margin-bottom: 40px;
                position: relative;
                overflow: hidden;
            }

            .header h1 {
                font-family: 'Orbitron', sans-serif;
                font-size: 3rem;
                margin-bottom: 10px;
                letter-spacing: 2px;
            }

            .header p {
                font-size: 1.2rem;
                opacity: 0.9;
                max-width: 800px;
                margin: 0 auto;
            }

            .pricing-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 25px;
                margin-bottom: 50px;
            }

            .price-card {
                background: var(--bg-card);
                border-radius: 15px;
                padding: 30px;
                text-align: center;
                border: 2px solid var(--border-color);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .price-card:hover {
                border-color: var(--primary);
                transform: translateY(-10px);
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }

            .price-card.featured {
                border-color: var(--accent);
            }

            .panel-type {
                font-family: 'Orbitron', sans-serif;
                font-size: 2rem;
                color: var(--primary);
                margin-bottom: 10px;
                text-transform: uppercase;
            }

            .panel-specs {
                font-size: 0.9rem;
                color: var(--text-sub);
                margin-bottom: 20px;
            }

            .price {
                font-size: 2.5rem;
                font-weight: bold;
                color: var(--accent);
                margin: 20px 0;
            }

            .price small {
                font-size: 1rem;
                color: var(--text-sub);
            }

            .btn-buy {
                background: linear-gradient(90deg, var(--primary), #2a5298);
                color: white;
                border: none;
                padding: 15px 30px;
                border-radius: 50px;
                font-family: 'Orbitron', sans-serif;
                font-size: 1.1rem;
                cursor: pointer;
                transition: all 0.3s ease;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
            }

            .btn-buy:hover {
                transform: scale(1.05);
                box-shadow: 0 10px 20px rgba(58, 109, 240, 0.3);
            }

            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                z-index: 1000;
                align-items: center;
                justify-content: center;
            }

            .modal-content {
                background: var(--bg-card);
                padding: 40px;
                border-radius: 20px;
                max-width: 500px;
                width: 90%;
                text-align: center;
                border: 2px solid var(--primary);
            }

            .modal h2 {
                font-family: 'Orbitron', sans-serif;
                margin-bottom: 20px;
                color: var(--primary);
            }

            .input-group {
                margin-bottom: 20px;
                text-align: left;
            }

            .input-group label {
                display: block;
                margin-bottom: 5px;
                color: var(--text-sub);
            }

            .input-group input {
                width: 100%;
                padding: 15px;
                background: rgba(255,255,255,0.1);
                border: 1px solid var(--border-color);
                border-radius: 10px;
                color: white;
                font-size: 1rem;
            }

            .qr-container {
                margin: 30px 0;
                padding: 20px;
                background: white;
                border-radius: 10px;
                display: inline-block;
            }

            .qr-container img {
                max-width: 250px;
                height: auto;
            }

            .payment-info {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                font-family: monospace;
                word-break: break-all;
            }

            .footer {
                text-align: center;
                padding: 30px;
                margin-top: 50px;
                border-top: 1px solid var(--border-color);
                color: var(--text-sub);
            }

            .admin-link {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: var(--primary);
                color: white;
                padding: 10px 20px;
                border-radius: 50px;
                text-decoration: none;
                font-family: 'Orbitron', sans-serif;
                font-size: 0.9rem;
            }

            @media (max-width: 768px) {
                .header h1 {
                    font-size: 2rem;
                }
                
                .pricing-grid {
                    grid-template-columns: 1fr;
                }
                
                .modal-content {
                    padding: 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${settings.nama_toko || 'NovaBot Panel'}</h1>
                <p>${settings.deskripsi || 'Jual Panel Pterodactyl Murah & Terpercaya'}</p>
                ${settings.video_promo ? `
                <div style="margin-top: 30px; max-width: 800px; margin-left: auto; margin-right: auto;">
                    <video src="${settings.video_promo}" controls autoplay muted loop style="width: 100%; border-radius: 10px;"></video>
                </div>
                ` : ''}
            </div>

            <div id="pricingContainer" class="pricing-grid">
                <!-- Harga panel akan di-load via JavaScript -->
            </div>

            <div class="footer">
                <p>${settings.footer_text || '© 2024 NovaBot Panel - All rights reserved'}</p>
                <p style="margin-top: 10px;">
                    ${settings.telegram_admin ? `<i class="fab fa-telegram"></i> ${settings.telegram_admin} • ` : ''}
                    ${settings.whatsapp_admin ? `<i class="fab fa-whatsapp"></i> ${settings.whatsapp_admin}` : ''}
                </p>
            </div>
        </div>

        <!-- Modal Pembayaran -->
        <div id="paymentModal" class="modal">
            <div class="modal-content">
                <h2><i class="fas fa-qrcode"></i> Bayar dengan QRIS</h2>
                <div id="paymentDetails">
                    <!-- Detail pembayaran akan diisi -->
                </div>
                <button onclick="closeModal()" style="background: #ff3b30; margin-top: 20px;" class="btn-buy">
                    <i class="fas fa-times"></i> Tutup
                </button>
            </div>
        </div>

        <a href="/admin" class="admin-link">
            <i class="fas fa-cog"></i> Admin Panel
        </a>

        <script>
            let currentOrder = null;
            let checkInterval = null;

            // Load harga panel
            async function loadPrices() {
                try {
                    const response = await fetch('/api/prices');
                    const data = await response.json();
                    
                    if (data.success) {
                        displayPrices(data.prices);
                    }
                } catch (error) {
                    console.error('Error loading prices:', error);
                }
            }

            function displayPrices(prices) {
                const container = document.getElementById('pricingContainer');
                const panelTypes = [
                    { type: '1gb', ram: '1GB', disk: '1GB', cpu: '40%' },
                    { type: '2gb', ram: '2GB', disk: '2GB', cpu: '60%' },
                    { type: '3gb', ram: '3GB', disk: '3GB', cpu: '80%' },
                    { type: '4gb', ram: '4GB', disk: '4GB', cpu: '100%' },
                    { type: '5gb', ram: '5GB', disk: '5GB', cpu: '120%' },
                    { type: '6gb', ram: '6GB', disk: '6GB', cpu: '140%' },
                    { type: '7gb', ram: '7GB', disk: '7GB', cpu: '160%' },
                    { type: '8gb', ram: '8GB', disk: '8GB', cpu: '180%' },
                    { type: '9gb', ram: '9GB', disk: '9GB', cpu: '200%' },
                    { type: '10gb', ram: '10GB', disk: '10GB', cpu: '220%' },
                    { type: 'unli', ram: 'Unlimited', disk: 'Unlimited', cpu: 'Unlimited' }
                ];

                let html = '';
                panelTypes.forEach(panel => {
                    const price = prices[panel.type] || 0;
                    const formattedPrice = price > 0 ? 
                        `Rp ${price.toLocaleString('id-ID')}` : 
                        '<span style="color: #ff3b30;">Belum diatur</span>';
                    
                    html += `
                    <div class="price-card ${panel.type === 'unli' ? 'featured' : ''}">
                        <div class="panel-type">${panel.type.toUpperCase()}</div>
                        <div class="panel-specs">
                            <div><i class="fas fa-memory"></i> RAM: ${panel.ram}</div>
                            <div><i class="fas fa-hdd"></i> DISK: ${panel.disk}</div>
                            <div><i class="fas fa-microchip"></i> CPU: ${panel.cpu}</div>
                        </div>
                        <div class="price">${formattedPrice}</div>
                        <button class="btn-buy" onclick="buyPanel('${panel.type}')" ${price <= 0 ? 'disabled style="opacity: 0.5;"' : ''}>
                            <i class="fas fa-shopping-cart"></i> 
                            ${price > 0 ? 'BELI SEKARANG' : 'HARGA BELUM DIATUR'}
                        </button>
                    </div>
                    `;
                });

                container.innerHTML = html;
            }

            // Fungsi pembelian panel
            async function buyPanel(panelType) {
                const email = prompt('Masukkan email Anda untuk menerima panel:');
                if (!email || !email.includes('@')) {
                    alert('Email tidak valid!');
                    return;
                }

                try {
                    const response = await fetch('/api/create-order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, panel_type: panelType })
                    });

                    const data = await response.json();
                    
                    if (data.success) {
                        currentOrder = data.order;
                        showPaymentModal(data);
                        startPaymentCheck(data.order.order_id);
                    } else {
                        alert(data.message || 'Gagal membuat order');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    alert('Terjadi kesalahan, silahkan coba lagi');
                }
            }

            // Tampilkan modal pembayaran
            function showPaymentModal(data) {
                const modal = document.getElementById('paymentModal');
                const details = document.getElementById('paymentDetails');
                
                let html = `
                    <div class="input-group">
                        <label>Email:</label>
                        <div style="padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">
                            ${data.order.email}
                        </div>
                    </div>
                    
                    <div class="input-group">
                        <label>Tipe Panel:</label>
                        <div style="padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">
                            ${data.order.panel_type.toUpperCase()}
                        </div>
                    </div>
                    
                    <div class="input-group">
                        <label>Total Pembayaran:</label>
                        <div style="padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; font-size: 1.5rem; color: #ffcc00;">
                            Rp ${data.order.amount.toLocaleString('id-ID')}
                        </div>
                    </div>
                    
                    ${data.qr_code ? `
                    <div class="qr-container">
                        <img src="${data.qr_code}" alt="QR Code">
                    </div>
                    ` : ''}
                    
                    ${data.order.qris_string ? `
                    <div class="input-group">
                        <label>QRIS String:</label>
                        <div class="payment-info">
                            ${data.order.qris_string}
                        </div>
                        <small style="color: var(--text-sub);">Scan dengan aplikasi e-wallet Anda</small>
                    </div>
                    ` : ''}
                    
                    <div id="paymentStatus" style="margin-top: 20px; padding: 10px; border-radius: 5px; background: rgba(255,255,255,0.1);">
                        <i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...
                    </div>
                `;
                
                details.innerHTML = html;
                modal.style.display = 'flex';
            }

            // Cek status pembayaran
            async function startPaymentCheck(orderId) {
                if (checkInterval) clearInterval(checkInterval);
                
                checkInterval = setInterval(async () => {
                    try {
                        const response = await fetch(\`/api/check-payment/\${orderId}\`);
                        const data = await response.json();
                        
                        if (data.success) {
                            const statusDiv = document.getElementById('paymentStatus');
                            
                            if (data.status === 'PAID') {
                                statusDiv.innerHTML = '<i class="fas fa-check-circle" style="color: #00ff88;"></i> Pembayaran berhasil! Panel sedang dibuat...';
                                clearInterval(checkInterval);
                                
                                // Tunggu 5 detik lalu refresh
                                setTimeout(() => {
                                    alert('Panel berhasil dibuat! Detail akan dikirim ke email Anda.');
                                    location.reload();
                                }, 5000);
                            } else if (data.status === 'EXPIRED') {
                                statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #ff3b30;"></i> Pembayaran kadaluarsa';
                                clearInterval(checkInterval);
                            }
                        }
                    } catch (error) {
                        console.error('Error checking payment:', error);
                    }
                }, 3000); // Cek setiap 3 detik
            }

            function closeModal() {
                document.getElementById('paymentModal').style.display = 'none';
                if (checkInterval) clearInterval(checkInterval);
            }

            // Tutup modal jika klik di luar
            window.onclick = function(event) {
                const modal = document.getElementById('paymentModal');
                if (event.target === modal) {
                    closeModal();
                }
            }

            // Load harga saat halaman terbuka
            document.addEventListener('DOMContentLoaded', loadPrices);
        </script>
    </body>
    </html>
    `;
}

function generateAdminPage() {
    return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Panel - NovaBot</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            :root {
                --bg-main: #02040a;
                --bg-card: #0b0f19;
                --primary: #3a6df0;
                --accent: #ffcc00;
                --danger: #ff3b30;
                --success: #00ff88;
                --text-main: #ffffff;
                --text-sub: #8b9bb4;
                --border-color: #1c2538;
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                font-family: 'Rajdhani', sans-serif;
            }

            body {
                background: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }

            .header {
                text-align: center;
                padding: 40px 20px;
                margin-bottom: 40px;
                border-bottom: 1px solid var(--border-color);
            }

            .header h1 {
                font-family: 'Orbitron', sans-serif;
                font-size: 2.5rem;
                color: var(--primary);
            }

            .tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 30px;
                overflow-x: auto;
            }

            .tab {
                background: var(--bg-card);
                border: 1px solid var(--border-color);
                padding: 15px 30px;
                cursor: pointer;
                border-radius: 10px 10px 0 0;
                white-space: nowrap;
                transition: all 0.3s ease;
            }

            .tab.active {
                background: var(--primary);
                border-color: var(--primary);
            }

            .tab-content {
                display: none;
                background: var(--bg-card);
                padding: 30px;
                border-radius: 0 10px 10px 10px;
                border: 1px solid var(--border-color);
            }

            .tab-content.active {
                display: block;
            }

            .form-group {
                margin-bottom: 20px;
            }

            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: var(--text-sub);
                font-weight: bold;
            }

            .form-group input, .form-group textarea {
                width: 100%;
                padding: 15px;
                background: rgba(255,255,255,0.1);
                border: 1px solid var(--border-color);
                border-radius: 10px;
                color: white;
                font-size: 1rem;
            }

            .form-group textarea {
                min-height: 100px;
                resize: vertical;
            }

            .price-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 15px;
            }

            .price-input {
                background: rgba(255,255,255,0.1);
                border: 1px solid var(--border-color);
                border-radius: 10px;
                padding: 15px;
            }

            .price-input label {
                display: block;
                margin-bottom: 5px;
                font-size: 0.9rem;
                color: var(--text-sub);
            }

            .price-input input {
                width: 100%;
                background: transparent;
                border: none;
                color: white;
                font-size: 1.2rem;
                outline: none;
            }

            .btn {
                background: var(--primary);
                color: white;
                border: none;
                padding: 15px 30px;
                border-radius: 10px;
                cursor: pointer;
                font-family: 'Orbitron', sans-serif;
                font-size: 1rem;
                transition: all 0.3s ease;
                display: inline-flex;
                align-items: center;
                gap: 10px;
            }

            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(58, 109, 240, 0.3);
            }

            .btn-success {
                background: var(--success);
            }

            .btn-danger {
                background: var(--danger);
            }

            .table-container {
                overflow-x: auto;
                margin-top: 20px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            th, td {
                padding: 15px;
                text-align: left;
                border-bottom: 1px solid var(--border-color);
            }

            th {
                background: rgba(255,255,255,0.05);
                font-family: 'Orbitron', sans-serif;
                color: var(--primary);
            }

            .status {
                padding: 5px 10px;
                border-radius: 5px;
                font-size: 0.8rem;
                font-weight: bold;
            }

            .status.pending {
                background: rgba(255, 204, 0, 0.2);
                color: var(--accent);
            }

            .status.completed {
                background: rgba(0, 255, 136, 0.2);
                color: var(--success);
            }

            .back-link {
                display: inline-block;
                margin-top: 30px;
                color: var(--text-sub);
                text-decoration: none;
            }

            .back-link:hover {
                color: var(--primary);
            }

            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .stat-card {
                background: var(--bg-card);
                padding: 25px;
                border-radius: 15px;
                border: 1px solid var(--border-color);
                text-align: center;
            }

            .stat-card h3 {
                font-family: 'Orbitron', sans-serif;
                font-size: 2.5rem;
                color: var(--primary);
                margin-bottom: 10px;
            }

            .stat-card p {
                color: var(--text-sub);
                font-size: 0.9rem;
            }

            .notification {
                padding: 15px;
                border-radius: 10px;
                margin-bottom: 20px;
                display: none;
            }

            .notification.success {
                background: rgba(0, 255, 136, 0.2);
                border: 1px solid var(--success);
                color: var(--success);
            }

            .notification.error {
                background: rgba(255, 59, 48, 0.2);
                border: 1px solid var(--danger);
                color: var(--danger);
            }

            @media (max-width: 768px) {
                .tabs {
                    flex-wrap: wrap;
                }
                
                .tab {
                    flex: 1;
                    min-width: 120px;
                    text-align: center;
                }
                
                .price-grid {
                    grid-template-columns: 1fr 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><i class="fas fa-cog"></i> Admin Panel NovaBot</h1>
                <p style="color: var(--text-sub); margin-top: 10px;">Management Panel Jualan</p>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <h3 id="totalOrders">0</h3>
                    <p>Total Orders</p>
                </div>
                <div class="stat-card">
                    <h3 id="totalRevenue">0</h3>
                    <p>Total Pendapatan</p>
                </div>
                <div class="stat-card">
                    <h3 id="activePanels">0</h3>
                    <p>Panel Aktif</p>
                </div>
                <div class="stat-card">
                    <h3 id="pendingOrders">0</h3>
                    <p>Pending Payment</p>
                </div>
            </div>

            <div id="notification" class="notification"></div>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('settings')">
                    <i class="fas fa-sliders-h"></i> Settings
                </div>
                <div class="tab" onclick="switchTab('prices')">
                    <i class="fas fa-tags"></i> Harga Panel
                </div>
                <div class="tab" onclick="switchTab('orders')">
                    <i class="fas fa-shopping-cart"></i> Orders
                </div>
                <div class="tab" onclick="switchTab('panels')">
                    <i class="fas fa-server"></i> Panels
                </div>
            </div>

            <div id="settingsTab" class="tab-content active">
                <h2 style="margin-bottom: 20px; color: var(--primary);"><i class="fas fa-cog"></i> Website Settings</h2>
                
                <form id="settingsForm">
                    <div class="form-group">
                        <label>Password Admin:</label>
                        <input type="password" id="adminPassword" placeholder="Masukkan password admin" required>
                    </div>

                    <div class="form-group">
                        <label>Nama Toko:</label>
                        <input type="text" id="namaToko" placeholder="Nama toko website">
                    </div>

                    <div class="form-group">
                        <label>Deskripsi:</label>
                        <textarea id="deskripsi" placeholder="Deskripsi toko"></textarea>
                    </div>

                    <div class="form-group">
                        <label>Foto Profil (URL):</label>
                        <input type="text" id="fotoProfil" placeholder="https://example.com/foto.jpg">
                    </div>

                    <div class="form-group">
                        <label>Video Promo (URL):</label>
                        <input type="text" id="videoPromo" placeholder="https://example.com/video.mp4">
                    </div>

                    <div class="form-group">
                        <label>Logo (URL):</label>
                        <input type="text" id="logoUrl" placeholder="https://example.com/logo.png">
                    </div>

                    <div class="form-group">
                        <label>Warna Utama:</label>
                        <input type="color" id="warnaUtama" value="#3a6df0">
                    </div>

                    <div class="form-group">
                        <label>Telegram Admin:</label>
                        <input type="text" id="telegramAdmin" placeholder="@username">
                    </div>

                    <div class="form-group">
                        <label>WhatsApp Admin:</label>
                        <input type="text" id="whatsappAdmin" placeholder="6281234567890">
                    </div>

                    <div class="form-group">
                        <label>Pesan Selamat Datang:</label>
                        <input type="text" id="pesanSelamatDatang" placeholder="Selamat datang di toko kami!">
                    </div>

                    <div class="form-group">
                        <label>Footer Text:</label>
                        <input type="text" id="footerText" placeholder="© 2024 All rights reserved">
                    </div>

                    <button type="submit" class="btn">
                        <i class="fas fa-save"></i> Simpan Settings
                    </button>
                </form>
            </div>

            <div id="pricesTab" class="tab-content">
                <h2 style="margin-bottom: 20px; color: var(--primary);"><i class="fas fa-tags"></i> Harga Panel</h2>
                
                <div class="price-grid" id="priceGrid">
                    <!-- Harga akan di-load via JavaScript -->
                </div>

                <button onclick="savePrices()" class="btn" style="margin-top: 20px;">
                    <i class="fas fa-save"></i> Simpan Harga
                </button>
            </div>

            <div id="ordersTab" class="tab-content">
                <h2 style="margin-bottom: 20px; color: var(--primary);"><i class="fas fa-shopping-cart"></i> Order Management</h2>
                
                <div class="table-container">
                    <table id="ordersTable">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Email</th>
                                <th>Panel</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Tanggal</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="ordersTableBody">
                            <!-- Data orders akan diisi -->
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="panelsTab" class="tab-content">
                <h2 style="margin-bottom: 20px; color: var(--primary);"><i class="fas fa-server"></i> Panel Management</h2>
                
                <div class="table-container">
                    <table id="panelsTable">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Email</th>
                                <th>Panel Type</th>
                                <th>Server ID</th>
                                <th>Status</th>
                                <th>Expires</th>
                            </tr>
                        </thead>
                        <tbody id="panelsTableBody">
                            <!-- Data panels akan diisi -->
                        </tbody>
                    </table>
                </div>
            </div>

            <a href="/" class="back-link">
                <i class="fas fa-arrow-left"></i> Kembali ke Halaman Utama
            </a>
        </div>

        <script>
            let adminPassword = '';
            let currentPrices = {};

            // Switch tab
            function switchTab(tabName) {
                // Hide all tabs
                document.querySelectorAll('.tab-content').forEach(tab => {
                    tab.classList.remove('active');
                });
                document.querySelectorAll('.tab').forEach(tab => {
                    tab.classList.remove('active');
                });

                // Show selected tab
                document.getElementById(tabName + 'Tab').classList.add('active');
                event.target.classList.add('active');
            }

            // Load dashboard stats
            async function loadStats() {
                try {
                    const response = await fetch('/api/admin/orders?password=' + adminPassword);
                    const ordersData = await response.json();
                    
                    if (ordersData.success) {
                        const orders = ordersData.orders || [];
                        const totalOrders = orders.length;
                        const totalRevenue = orders.reduce((sum, order) => sum + (order.amount || 0), 0);
                        const pendingOrders = orders.filter(order => order.status === 'pending').length;
                        
                        document.getElementById('totalOrders').textContent = totalOrders;
                        document.getElementById('totalRevenue').textContent = 'Rp ' + totalRevenue.toLocaleString('id-ID');
                        document.getElementById('pendingOrders').textContent = pendingOrders;
                    }
                } catch (error) {
                    console.error('Error loading stats:', error);
                }

                try {
                    const response = await fetch('/api/admin/panels?password=' + adminPassword);
                    const panelsData = await response.json();
                    
                    if (panelsData.success) {
                        const panels = panelsData.panels || [];
                        const activePanels = panels.filter(panel => panel.status === 'active').length;
                        
                        document.getElementById('activePanels').textContent = activePanels;
                    }
                } catch (error) {
                    console.error('Error loading panels:', error);
                }
            }

            // Load settings
            async function loadSettings() {
                try {
                    const response = await fetch('/api/settings');
                    const data = await response.json();
                    
                    if (data.success) {
                        const settings = data.settings;
                        
                        // Isi form settings
                        document.getElementById('namaToko').value = settings.nama_toko || '';
                        document.getElementById('deskripsi').value = settings.deskripsi || '';
                        document.getElementById('fotoProfil').value = settings.foto_profil || '';
                        document.getElementById('videoPromo').value = settings.video_promo || '';
                        document.getElementById('logoUrl').value = settings.logo_url || '';
                        document.getElementById('warnaUtama').value = settings.warna_utama || '#3a6df0';
                        document.getElementById('telegramAdmin').value = settings.telegram_admin || '';
                        document.getElementById('whatsappAdmin').value = settings.whatsapp_admin || '';
                        document.getElementById('pesanSelamatDatang').value = settings.pesan_selamat_datang || '';
                        document.getElementById('footerText').value = settings.footer_text || '';
                        
                        // Isi harga
                        currentPrices = settings.harga_panel || {};
                        displayPrices();
                    }
                } catch (error) {
                    console.error('Error loading settings:', error);
                }
            }

            // Display prices in grid
            function displayPrices() {
                const priceGrid = document.getElementById('priceGrid');
                const panelTypes = [
                    '1gb', '2gb', '3gb', '4gb', '5gb',
                    '6gb', '7gb', '8gb', '9gb', '10gb', 'unli'
                ];

                let html = '';
                panelTypes.forEach(type => {
                    const price = currentPrices[type] || 0;
                    html += \`
                    <div class="price-input">
                        <label>\${type.toUpperCase()}</label>
                        <input type="number" id="price_\${type}" 
                               value="\${price}" 
                               placeholder="0"
                               onchange="updatePrice('\${type}', this.value)">
                    </div>
                    \`;
                });

                priceGrid.innerHTML = html;
            }

            // Update price in memory
            function updatePrice(type, value) {
                currentPrices[type] = parseInt(value) || 0;
            }

            // Save settings
            document.getElementById('settingsForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                adminPassword = document.getElementById('adminPassword').value;
                if (!adminPassword) {
                    showNotification('Password admin harus diisi!', 'error');
                    return;
                }

                const settings = {
                    nama_toko: document.getElementById('namaToko').value,
                    deskripsi: document.getElementById('deskripsi').value,
                    foto_profil: document.getElementById('fotoProfil').value,
                    video_promo: document.getElementById('videoPromo').value,
                    logo_url: document.getElementById('logoUrl').value,
                    warna_utama: document.getElementById('warnaUtama').value,
                    telegram_admin: document.getElementById('telegramAdmin').value,
                    whatsapp_admin: document.getElementById('whatsappAdmin').value,
                    pesan_selamat_datang: document.getElementById('pesanSelamatDatang').value,
                    footer_text: document.getElementById('footerText').value,
                    harga_panel: currentPrices
                };

                try {
                    const response = await fetch('/api/admin/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...settings, password: adminPassword })
                    });

                    const data = await response.json();
                    
                    if (data.success) {
                        showNotification('Settings berhasil disimpan!', 'success');
                        loadStats();
                    } else {
                        showNotification(data.message || 'Gagal menyimpan settings', 'error');
                    }
                } catch (error) {
                    console.error('Error saving settings:', error);
                    showNotification('Terjadi kesalahan', 'error');
                }
            });

            // Save prices only
            async function savePrices() {
                if (!adminPassword) {
                    adminPassword = prompt('Masukkan password admin:');
                    if (!adminPassword) return;
                }

                try {
                    const response = await fetch('/api/admin/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            harga_panel: currentPrices,
                            password: adminPassword 
                        })
                    });

                    const data = await response.json();
                    
                    if (data.success) {
                        showNotification('Harga berhasil disimpan!', 'success');
                    } else {
                        showNotification(data.message || 'Gagal menyimpan harga', 'error');
                    }
                } catch (error) {
                    console.error('Error saving prices:', error);
                    showNotification('Terjadi kesalahan', 'error');
                }
            }

            // Load orders
            async function loadOrders() {
                if (!adminPassword) return;
                
                try {
                    const response = await fetch('/api/admin/orders?password=' + adminPassword);
                    const data = await response.json();
                    
                    if (data.success) {
                        const tbody = document.getElementById('ordersTableBody');
                        const orders = data.orders || [];
                        
                        let html = '';
                        orders.forEach(order => {
                            html += \`
                            <tr>
                                <td>\${order.order_id}</td>
                                <td>\${order.email}</td>
                                <td>\${order.panel_type.toUpperCase()}</td>
                                <td>Rp \${order.amount ? order.amount.toLocaleString('id-ID') : 0}</td>
                                <td>
                                    <span class="status \${order.status}">\${order.status}</span>
                                </td>
                                <td>\${new Date(order.created_at).toLocaleString('id-ID')}</td>
                                <td>
                                    <button onclick="checkOrderStatus('\${order.order_id}')" class="btn" style="padding: 5px 10px; font-size: 0.8rem;">
                                        <i class="fas fa-sync"></i>
                                    </button>
                                </td>
                            </tr>
                            \`;
                        });
                        
                        tbody.innerHTML = html || '<tr><td colspan="7" style="text-align: center;">Tidak ada data</td></tr>';
                    }
                } catch (error) {
                    console.error('Error loading orders:', error);
                }
            }

            // Load panels
            async function loadPanels() {
                if (!adminPassword) return;
                
                try {
                    const response = await fetch('/api/admin/panels?password=' + adminPassword);
                    const data = await response.json();
                    
                    if (data.success) {
                        const tbody = document.getElementById('panelsTableBody');
                        const panels = data.panels || [];
                        
                        let html = '';
                        panels.forEach(panel => {
                            const expires = panel.expiresAt ? new Date(panel.expiresAt).toLocaleDateString('id-ID') : '-';
                            
                            html += \`
                            <tr>
                                <td>\${panel.id}</td>
                                <td>\${panel.username}</td>
                                <td>\${panel.panelType.toUpperCase()}</td>
                                <td>\${panel.serverId}</td>
                                <td>
                                    <span class="status \${panel.status}">\${panel.status}</span>
                                </td>
                                <td>\${expires}</td>
                            </tr>
                            \`;
                        });
                        
                        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align: center;">Tidak ada data</td></tr>';
                    }
                } catch (error) {
                    console.error('Error loading panels:', error);
                }
            }

            // Check order status
            async function checkOrderStatus(orderId) {
                try {
                    const response = await fetch(\`/api/check-payment/\${orderId}\`);
                    const data = await response.json();
                    
                    if (data.success) {
                        showNotification(\`Status order \${orderId}: \${data.status}\`, 'success');
                        loadOrders();
                        loadPanels();
                        loadStats();
                    }
                } catch (error) {
                    console.error('Error checking order:', error);
                }
            }

            // Show notification
            function showNotification(message, type) {
                const notification = document.getElementById('notification');
                notification.textContent = message;
                notification.className = \`notification \${type}\`;
                notification.style.display = 'block';
                
                setTimeout(() => {
                    notification.style.display = 'none';
                }, 5000);
            }

            // Event listener untuk tab orders dan panels
            document.querySelector('.tab[onclick="switchTab(\'orders\')"]').addEventListener('click', function() {
                setTimeout(() => {
                    if (adminPassword) {
                        loadOrders();
                    } else {
                        adminPassword = prompt('Masukkan password admin:');
                        if (adminPassword) {
                            loadOrders();
                        }
                    }
                }, 100);
            });

            document.querySelector('.tab[onclick="switchTab(\'panels\')"]').addEventListener('click', function() {
                setTimeout(() => {
                    if (adminPassword) {
                        loadPanels();
                    } else {
                        adminPassword = prompt('Masukkan password admin:');
                        if (adminPassword) {
                            loadPanels();
                        }
                    }
                }, 100);
            });

            // Load data saat halaman dibuka
            document.addEventListener('DOMContentLoaded', function() {
                loadSettings();
            });
        </script>
    </body>
    </html>
    `;
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 START SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.listen(PORT, HOST, () => {
    console.log(`
    ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
    ┃                                    ┃
    ┃   🚀 NovaBot Panel Started!       ┃
    ┃                                    ┃
    ┠────────────────────────────────────┨
    ┃  🌐 Server: http://${HOST}:${PORT}    ┃
    ┃  📱 Admin:  http://${HOST}:${PORT}/admin ┃
    ┃  🔧 Version: ${config.VERSI_WEB}          ┃
    ┃                                    ┃
    ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
    `);
});
