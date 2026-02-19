const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require("path");
const rateLimit = require("express-rate-limit");
const config = require('./setting.js');

const app = express();
const PORT = config.PORT || 8080;
const HOST = config.HOST || 'localhost';

// In-memory storage untuk order
const orders = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

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
        return null;
    }
}

async function checkPaymentStatus(orderId) {
    try {
        const detailUrl = `https://app.pakasir.com/api/transactiondetail?project=${encodeURIComponent(config.PAKASIR_PROJECT)}&amount=0&order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(config.PAKASIR_API_KEY)}`;
        const response = await fetch(detailUrl);
        const data = await response.json();
        
        const transaction = data.transaction || data || {};
        
        // Normalize status
        let status = transaction.status || '';
        if (typeof status === 'string') {
            status = status.toLowerCase();
            if (status === 'success') status = 'paid';
            if (status === 'settled') status = 'paid';
        }
        
        return {
            success: true,
            status: status,
            transaction: transaction,
            raw: data
        };
    } catch (error) {
        return null;
    }
}

async function processPayment(orderId, amount) {
    try {
        const qrData = await createQRISPayment(orderId, amount);
        if (!qrData) {
            throw new Error('Gagal membuat pembayaran QRIS');
        }
        return qrData;
    } catch (error) {
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖥️ CREATE PTERODACTYL SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createPterodactylServer(userId, panelType, username, serverName = null) {
    try {
        let ram, disk, cpu;
        
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
            throw new Error(serverData.errors[0].detail || 'Gagal membuat server');
        }

        return {
            success: true,
            serverId: serverData.attributes.id,
            identifier: serverData.attributes.identifier,
            name: safeServerName,
            panelType: panelType,
            ram: ram,
            disk: disk,
            cpu: cpu,
            createdAt: new Date().toISOString(),
            panelUrl: `${config.URL}/server/${serverData.attributes.identifier}`
        };
    } catch (error) {
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

function escapeHTML(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 ROUTES API
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. CREATE Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { email, panel_type } = req.body;
        
        if (!email || !panel_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email dan tipe panel harus diisi' 
            });
        }

        // Get price from config
        const priceMap = {
            '1gb': config.PRICE_1GB || 500,
            '2gb': config.PRICE_2GB || 500,
            '3gb': config.PRICE_3GB || 500,
            '4gb': config.PRICE_4GB || 500,
            '5gb': config.PRICE_5GB || 500,
            '6gb': config.PRICE_6GB || 500,
            '7gb': config.PRICE_7GB || 500,
            '8gb': config.PRICE_8GB || 500,
            '9gb': config.PRICE_9GB || 500,
            '10gb': config.PRICE_10GB || 500,
            'unli': config.PRICE_UNLI || 500,
            'unlimited': config.PRICE_UNLI || 500
        };
        
        const amount = priceMap[panel_type] || 500;
        
        if (amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Harga tidak valid' 
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
        const order = {
            order_id: orderId,
            email: email,
            panel_type: panel_type,
            amount: amount,
            payment_number: payment.payment_number,
            qris_string: payment.qris_string,
            status: 'pending',
            created_at: new Date().toISOString(),
            panel_created: false
        };

        orders.set(orderId, order);

        // Generate QR Code URL
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(payment.qris_string)}&size=300&margin=1`;

        res.json({
            success: true,
            order: order,
            qr_url: qrUrl,
            payment_info: payment
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 2. CHECK Payment Status
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
        const order = orders.get(orderId);
        if (order) {
            order.status = paymentStatus.status;
            orders.set(orderId, order);
        }

        res.json({
            success: true,
            status: paymentStatus.status,
            order_id: orderId,
            transaction: paymentStatus.transaction
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 3. CREATE Panel setelah pembayaran berhasil
app.post('/api/create-panel', async (req, res) => {
    try {
        const { order_id, email, panel_type } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Order ID diperlukan' 
            });
        }

        // Cek apakah order ada dan sudah dibayar
        const order = orders.get(order_id);
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order tidak ditemukan' 
            });
        }

        // Validasi status pembayaran
        const paidStatuses = ['paid', 'success', 'settled'];
        if (!paidStatuses.includes(order.status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Pembayaran belum berhasil. Status: ' + order.status 
            });
        }

        if (order.panel_created) {
            return res.status(400).json({ 
                success: false, 
                message: 'Panel sudah dibuat sebelumnya' 
            });
        }

        // Buat panel di Pterodactyl
        const panelResult = await createPterodactylServer(
            'user_' + Date.now(),
            panel_type || order.panel_type,
            (email || order.email).split('@')[0]
        );

        if (!panelResult.success) {
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal membuat panel' 
            });
        }

        // Update order
        order.panel_created = true;
        order.panel_data = panelResult;
        orders.set(order_id, order);

        // Kirim notifikasi ke Telegram dengan format HTML
        const ownerMsg = `<blockquote>✅ PANEL BARU DIBUAT</blockquote>\n\n` +
            `<b>📅 Waktu:</b> ${new Date().toLocaleString('id-ID')}\n` +
            `<b>📧 Email:</b> ${escapeHTML(order.email)}\n` +
            `<b>📦 Tipe Panel:</b> ${order.panel_type.toUpperCase()}\n` +
            `<b>💰 Harga:</b> Rp ${order.amount.toLocaleString('id-ID')}\n` +
            `<b>🆔 Server ID:</b> <code>${panelResult.serverId}</code>\n` +
            `<b>🏷️ Nama Server:</b> ${escapeHTML(panelResult.name)}\n` +
            `<b>💾 RAM:</b> ${panelResult.ram === 0 ? 'Unlimited' : panelResult.ram + 'MB'}\n` +
            `<b>💿 Disk:</b> ${panelResult.disk === 0 ? 'Unlimited' : panelResult.disk + 'MB'}\n` +
            `<b>⚡ CPU:</b> ${panelResult.cpu === 0 ? 'Unlimited' : panelResult.cpu + '%'}`;

        const ownerKeyboard = {
            inline_keyboard: [
                [
                    { 
                        text: '🛒 Beli Panel', 
                        url: config.URL
                    }
                ]
            ]
        };

        // Kirim notifikasi ke Telegram
        try {
            const url = `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.OWNER_ID,
                    text: ownerMsg,
                    parse_mode: 'HTML',
                    reply_markup: ownerKeyboard
                })
            });
            
            const result = await response.json();
            if (!result.ok) {
                // Silent fail for Telegram errors
            }
        } catch (telegramError) {
            // Silent fail for Telegram errors
        }

        res.json({
            success: true,
            panel: panelResult,
            message: 'Panel berhasil dibuat!'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Internal server error' 
        });
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 ROUTE UTAMA (HTML) - TIDAK DIUBAH
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <title>Novabot Panel</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Orbitron:wght@500;700;900&family=VT323&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            /* ========================================= */
            /* 1. RESET & GLOBAL STYLES */
            /* ========================================= */
            :root {
                --bg-main: #02040a;       
                --bg-card: #0b0f19;       
                --primary: #3a6df0;       
                --accent-red: #ff3b30;    
                --accent-gold: #ffcc00;   
                --text-main: #ffffff;
                --text-sub: #8b9bb4;
                --border-color: #1c2538;
            }

            * { 
                box-sizing: border-box; margin: 0; padding: 0; 
                -webkit-tap-highlight-color: transparent; 
                outline: none;
            }
            
            body {
                font-family: 'Rajdhani', sans-serif;
                background: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                position: relative; 
                overflow-x: hidden; 
                padding-bottom: 80px; 
            }

            ::-webkit-scrollbar { width: 0px; }

            /* ========================================= */
            /* 2. HEADER */
            /* ========================================= */
            .custom-header {
                position: fixed; top: 0; left: 0; width: 100%; height: 60px;
                background: rgba(2, 4, 10, 0.95); backdrop-filter: blur(10px);
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 20px; z-index: 1000;
                border-bottom: 1px solid var(--border-color);
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            }

            .header-left { display: flex; align-items: center; gap: 15px; }
            .header-title { font-family: 'Orbitron', sans-serif; font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; }
            
            /* ========================================= */
            /* 3. DASHBOARD COMPONENTS */
            /* ========================================= */
            .page-container { 
                padding: 80px 20px 20px 20px; 
            }

            .lux-header-card {
                background: linear-gradient(135deg, #1e3c72, #2a5298); 
                border-radius: 20px; padding: 25px 20px; color: white;
                box-shadow: 0 10px 30px rgba(30, 60, 114, 0.3);
                margin-bottom: 30px; position: relative; overflow: hidden;
                border: 1px solid rgba(255,255,255,0.1);
            }
            
            .lux-icon-box { width: 50px; height: 50px; background: rgba(255,255,255,0.2); border-radius: 12px; display: flex; justify-content: center; align-items: center; font-size: 24px; backdrop-filter: blur(5px); }
            
            .lux-head-text h2 { font-family: 'Orbitron'; font-size: 18px; margin-bottom: 2px; letter-spacing: 1px; }
            .lux-head-text p { font-size: 12px; color: rgba(255,255,255,0.8); font-family: 'Rajdhani'; }

            .lux-section-title { 
                font-family: 'Orbitron'; font-size: 16px; color: #fff; 
                margin-bottom: 15px; letter-spacing: 1px; 
                padding-left: 5px; border-left: 3px solid var(--primary); 
                line-height: 1; 
            }

            /* SLIDER */
            .slider-container {
                width: 100%; background: var(--bg-card); border-radius: 20px; overflow: hidden;
                border: 1px solid var(--border-color); box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                margin-bottom: 30px; position: relative; touch-action: pan-y; user-select: none;
                height: 200px;
            }
            
            .slide { 
                min-width: 100%; height: 100%; position: relative; display: block; 
            }
            
            .slide video { 
                width: 100%; height: 100%; object-fit: cover; display: block; 
                border-bottom: 1px solid rgba(255,255,255,0.1); pointer-events: none; 
            }
            
            .lux-news-content { 
                position: absolute; bottom: 0; left: 0; width: 100%; padding: 20px; 
                display: flex; flex-direction: column; justify-content: flex-end;
                background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
                z-index: 5;
            }
            
            .lux-news-content h3 { font-family: 'Orbitron'; font-size: 16px; color: #fff; margin-bottom: 5px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
            .lux-news-content p { font-size: 12px; color: #d0d0d0; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }

            /* PRICING GRID */
            .pricing-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 15px;
                margin-bottom: 30px;
            }

            .price-card {
                background: var(--bg-card);
                border-radius: 15px;
                padding: 20px;
                text-align: center;
                border: 2px solid var(--border-color);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .price-card:hover {
                border-color: var(--primary);
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(58, 109, 240, 0.2);
            }

            .panel-type {
                font-family: 'Orbitron';
                font-size: 1.5rem;
                color: var(--primary);
                margin-bottom: 10px;
                text-transform: uppercase;
            }

            .panel-specs {
                font-size: 0.9rem;
                color: var(--text-sub);
                margin-bottom: 15px;
                line-height: 1.4;
            }

            .price {
                font-size: 2rem;
                font-weight: bold;
                color: var(--accent-gold);
                margin: 15px 0;
            }

            .price-input {
                width: 100%;
                padding: 12px;
                background: rgba(255,255,255,0.1);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                color: white;
                font-family: 'VT323', monospace;
                font-size: 16px;
                margin-bottom: 15px;
                text-align: center;
            }

            .price-input::placeholder {
                color: var(--text-sub);
            }

            .yoshi-btn { 
                width: 100%; 
                padding: 16px; 
                margin-top: 10px; 
                background: linear-gradient(90deg, #1e3c72, #2a5298); 
                border: none; 
                border-radius: 50px; 
                color: #fff; 
                font-family: 'Orbitron'; 
                font-size: 16px; 
                font-weight: bold; 
                cursor: pointer; 
                box-shadow: 0 0 20px rgba(58, 109, 240, 0.3); 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                gap: 10px; 
                transition: 0.2s; 
            }
            
            .yoshi-btn:active { 
                transform: scale(0.98); 
            }

            .yoshi-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* MODAL STYLES */
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.9);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }

            .modal-content {
                background: var(--bg-card);
                padding: 30px;
                border-radius: 20px;
                max-width: 400px;
                width: 90%;
                text-align: center;
                border: 2px solid var(--primary);
                box-shadow: 0 0 30px rgba(58, 109, 240, 0.2);
            }

            .modal h2 {
                font-family: 'Orbitron';
                color: var(--primary);
                margin-bottom: 20px;
                font-size: 1.5rem;
            }

            .qr-container {
                margin: 20px 0;
                padding: 15px;
                background: white;
                border-radius: 10px;
                display: inline-block;
            }

            .qr-container img {
                width: 250px;
                height: 250px;
                display: block;
            }

            .payment-info {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                font-family: monospace;
                word-break: break-all;
                font-size: 12px;
                color: #fff;
            }

            .status-message {
                margin: 15px 0;
                padding: 10px;
                border-radius: 8px;
                background: rgba(255,255,255,0.1);
                font-size: 14px;
                color: var(--text-sub);
            }

            .status-message.success {
                background: rgba(0, 255, 136, 0.1);
                color: #00ff88;
                border: 1px solid #00ff88;
            }

            .status-message.error {
                background: rgba(255, 59, 48, 0.1);
                color: #ff3b30;
                border: 1px solid #ff3b30;
            }

            .status-message.pending {
                background: rgba(255, 204, 0, 0.1);
                color: #ffcc00;
                border: 1px solid #ffcc00;
            }

            .close-btn {
                background: var(--accent-red);
                color: white;
                border: none;
                padding: 12px 25px;
                border-radius: 8px;
                font-family: 'Orbitron';
                cursor: pointer;
                margin-top: 15px;
            }

            /* EMAIL MODAL STYLES */
            .email-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.9);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }

            .email-modal-content {
                background: var(--bg-card);
                padding: 40px 30px;
                border-radius: 20px;
                max-width: 500px;
                width: 90%;
                text-align: center;
                border: 2px solid var(--primary);
                box-shadow: 0 0 40px rgba(58, 109, 240, 0.3);
                position: relative;
                overflow: hidden;
            }

            .email-modal-bg {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                opacity: 0.1;
                z-index: -1;
            }

            .email-modal-bg video {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .email-modal h2 {
                font-family: 'Orbitron';
                color: var(--primary);
                margin-bottom: 20px;
                font-size: 1.8rem;
                text-shadow: 0 0 10px rgba(58, 109, 240, 0.5);
            }

            .email-input-group {
                margin: 30px 0;
                position: relative;
            }

            .email-input {
                width: 100%;
                padding: 20px 20px 20px 50px;
                background: rgba(255,255,255,0.1);
                border: 2px solid var(--border-color);
                border-radius: 15px;
                color: white;
                font-family: 'Rajdhani', sans-serif;
                font-size: 18px;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
            }

            .email-input:focus {
                border-color: var(--primary);
                box-shadow: 0 0 20px rgba(58, 109, 240, 0.3);
                outline: none;
            }

            .email-input::placeholder {
                color: rgba(255,255,255,0.5);
            }

            .email-icon {
                position: absolute;
                left: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: var(--primary);
                font-size: 20px;
            }

            .email-submit-btn {
                width: 100%;
                padding: 20px;
                background: linear-gradient(90deg, #1e3c72, #2a5298);
                border: none;
                border-radius: 15px;
                color: #fff;
                font-family: 'Orbitron';
                font-size: 18px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 0 25px rgba(58, 109, 240, 0.4);
                transition: all 0.3s ease;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
            }

            .email-submit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 35px rgba(58, 109, 240, 0.6);
            }

            .email-submit-btn:active {
                transform: translateY(0);
            }

            .email-note {
                margin-top: 20px;
                color: var(--text-sub);
                font-size: 14px;
                line-height: 1.5;
            }

            .button-group {
                display: flex;
                gap: 10px;
                margin-top: 15px;
            }

            /* FOOTER */
            .footer {
                text-align: center;
                padding: 20px;
                margin-top: 30px;
                border-top: 1px solid var(--border-color);
                color: var(--text-sub);
                font-size: 12px;
            }

            @media (max-width: 768px) {
                .pricing-grid {
                    grid-template-columns: 1fr;
                }
                
                .modal-content {
                    padding: 20px;
                }
                
                .qr-container img {
                    width: 200px;
                    height: 200px;
                }
                
                .email-modal-content {
                    padding: 30px 20px;
                }
            }
        </style>
    </head>
    <body>
        <!-- HEADER -->
        <div class="custom-header">
            <div class="header-left">
                <div class="header-title">NOVABOT PANEL</div>
            </div>
            <div style="color: var(--text-sub); font-size: 12px;">
                <i class="fas fa-bolt"></i> Powered by NovaBot
            </div>
        </div>

        <!-- MAIN CONTENT -->
        <div class="page-container">
            <!-- HEADER CARD -->
            <div class="lux-header-card">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                    <div class="lux-icon-box"><i class="fas fa-server"></i></div>
                    <div class="lux-head-text">
                        <p>Welcome to</p>
                        <h2>NovaBot Panel Store</h2>
                    </div>
                </div>
                <div style="font-size: 14px; opacity: 0.9;">
                    Jual panel Pterodactyl terbaik dengan harga terjangkau. Pembayaran via QRIS.
                </div>
            </div>

            <!-- NEWS SLIDER -->
            <div class="lux-section-title">Latest News</div>
            <div class="slider-container">
                <div class="slide">
                    <video src="https://files.catbox.moe/7iyjd5.mp4" autoplay muted loop playsinline></video>
                    <div class="lux-news-content">
                        <h3>NovaBot Panel v${config.VERSI_WEB}</h3>
                        <p>Panel Pterodactyl siap pakai dengan sistem pembayaran otomatis</p>
                    </div>
                </div>
            </div>

            <!-- PRICING SECTION -->
            <div class="lux-section-title">Pilih Panel Anda</div>
            
            <div class="pricing-grid" id="pricingGrid">
                <!-- Price cards will be generated by JavaScript -->
            </div>

            <!-- FOOTER -->
            <div class="footer">
                <p>© 2026 NovaBot Panel - All rights reserved</p>
                <p style="margin-top: 10px;">
                    <i class="fab fa-telegram"></i> ${config.DEVELOPER} • 
                    <i class="fas fa-code"></i> Version ${config.VERSI_WEB}
                </p>
            </div>
        </div>

        <!-- EMAIL MODAL dengan VIDEO BACKGROUND -->
        <div id="emailModal" class="email-modal">
            <div class="email-modal-content">
                <div class="email-modal-bg">
                    <video src="https://files.catbox.moe/7iyjd5.mp4" autoplay muted loop playsinline></video>
                </div>
                <h2><i class="fas fa-envelope"></i> Masukkan Email</h2>
                <p style="color: var(--text-sub); margin-bottom: 20px;">
                    Masukkan email Anda untuk menerima informasi panel
                </p>
                <div class="email-input-group">
                    <i class="fas fa-envelope email-icon"></i>
                    <input type="email" id="userEmail" class="email-input" placeholder="contoh: nama@email.com" required>
                </div>
                <div class="button-group">
                    <button class="yoshi-btn" style="background: linear-gradient(90deg, #6b7280, #4b5563);" onclick="closeEmailModal()">
                        <i class="fas fa-times"></i> Batal
                    </button>
                    <button class="email-submit-btn" onclick="submitEmail()">
                        <i class="fas fa-check"></i> Lanjutkan
                    </button>
                </div>
                <div class="email-note">
                    <i class="fas fa-info-circle"></i> Pastikan email aktif. Detail panel akan dikirim ke email ini.
                </div>
            </div>
        </div>

        <!-- PAYMENT MODAL -->
        <div id="paymentModal" class="modal">
            <div class="modal-content">
                <h2><i class="fas fa-qrcode"></i> Bayar dengan QRIS</h2>
                
                <div id="paymentDetails">
                    <!-- Payment details will be inserted here -->
                </div>
                
                <div class="button-group">
                    <button class="close-btn" onclick="closeModal()">
                        <i class="fas fa-times"></i> Tutup
                    </button>
                    <button class="yoshi-btn" id="checkStatusBtn" onclick="manualCheckStatus()">
                        <i class="fas fa-sync-alt"></i> Cek Status
                    </button>
                </div>
            </div>
        </div>

        <script>
            let currentOrder = null;
            let checkInterval = null;
            let currentPrice = 0;
            let currentPanelType = '';
            let currentEmail = '';

            // Panel data dengan harga dari setting
            const panelData = [
                { type: '1gb', ram: '1GB', disk: '1GB', cpu: '40%', price: ${config.PRICE_1GB || 500} },
                { type: '2gb', ram: '2GB', disk: '2GB', cpu: '60%', price: ${config.PRICE_2GB || 500} },
                { type: '3gb', ram: '3GB', disk: '3GB', cpu: '80%', price: ${config.PRICE_3GB || 500} },
                { type: '4gb', ram: '4GB', disk: '4GB', cpu: '100%', price: ${config.PRICE_4GB || 500} },
                { type: '5gb', ram: '5GB', disk: '5GB', cpu: '120%', price: ${config.PRICE_5GB || 500} },
                { type: '6gb', ram: '6GB', disk: '6GB', cpu: '140%', price: ${config.PRICE_6GB || 500} },
                { type: '7gb', ram: '7GB', disk: '7GB', cpu: '160%', price: ${config.PRICE_7GB || 500} },
                { type: '8gb', ram: '8GB', disk: '8GB', cpu: '180%', price: ${config.PRICE_8GB || 500} },
                { type: '9gb', ram: '9GB', disk: '9GB', cpu: '200%', price: ${config.PRICE_9GB || 500} },
                { type: '10gb', ram: '10GB', disk: '10GB', cpu: '220%', price: ${config.PRICE_10GB || 500} },
                { type: 'unli', ram: 'Unlimited', disk: 'Unlimited', cpu: 'Unlimited', price: ${config.PRICE_UNLI || 500} }
            ];

            // Generate price cards
            function generatePriceCards() {
                const grid = document.getElementById('pricingGrid');
                let html = '';
                
                panelData.forEach(panel => {
                    html += \`
                    <div class="price-card">
                        <div class="panel-type">\${panel.type.toUpperCase()}</div>
                        <div class="panel-specs">
                            <div><i class="fas fa-memory"></i> RAM: \${panel.ram}</div>
                            <div><i class="fas fa-hdd"></i> DISK: \${panel.disk}</div>
                            <div><i class="fas fa-microchip"></i> CPU: \${panel.cpu}</div>
                        </div>
                        <div class="price">Rp \${panel.price.toLocaleString('id-ID')}</div>
                        <button class="yoshi-btn" onclick="openEmailModal('\${panel.type}', \${panel.price})">
                            <i class="fas fa-shopping-cart"></i> BELI SEKARANG
                        </button>
                    </div>
                    \`;
                });
                
                grid.innerHTML = html;
            }

            // Open email modal
            function openEmailModal(panelType, price) {
                currentPanelType = panelType;
                currentPrice = price;
                document.getElementById('emailModal').style.display = 'flex';
                document.getElementById('userEmail').focus();
            }

            // Close email modal
            function closeEmailModal() {
                document.getElementById('emailModal').style.display = 'none';
                document.getElementById('userEmail').value = '';
            }

            // Submit email
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

            // Create order function
            async function createOrder(email, panelType, price) {
                try {
                    const response = await fetch('/api/create-order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            email: email, 
                            panel_type: panelType
                        })
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

            // Show payment modal
            function showPaymentModal(data, email, panelType) {
                const modal = document.getElementById('paymentModal');
                const details = document.getElementById('paymentDetails');
                
                let html = \`
                    <div style="text-align: left; margin-bottom: 20px;">
                        <div style="margin-bottom: 10px;">
                            <strong>Order ID:</strong><br>
                            <span style="color: var(--text-sub); font-family: monospace;">\${data.order.order_id}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Email:</strong><br>
                            <span style="color: var(--text-sub);">\${email}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Panel Type:</strong><br>
                            <span style="color: var(--accent-gold);">\${panelType.toUpperCase()}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Total Pembayaran:</strong><br>
                            <span style="font-size: 1.5rem; color: var(--accent-gold);">
                                Rp \${currentPrice.toLocaleString('id-ID')}
                            </span>
                        </div>
                    </div>
                    
                    <div class="qr-container">
                        <img src="\${data.qr_url}" alt="QR Code">
                    </div>
                    
                    \${data.order.qris_string ? \`
                    <div style="margin: 15px 0;">
                        <div><strong>QRIS String:</strong></div>
                        <div class="payment-info">\${data.order.qris_string}</div>
                        <small style="color: var(--text-sub);">Scan dengan aplikasi e-wallet Anda</small>
                    </div>
                    \` : ''}
                    
                    <div id="paymentStatus" class="status-message pending">
                        <i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...
                    </div>
                \`;
                
                details.innerHTML = html;
                modal.style.display = 'flex';
            }

            // Manual check status
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

            // Start payment check
            function startPaymentCheck(orderId, email, panelType) {
                if (checkInterval) clearInterval(checkInterval);
                
                checkInterval = setInterval(async () => {
                    await checkPaymentStatus(orderId, email, panelType);
                }, 3000);
            }

            // Check payment status
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
                            
                            // Buat panel setelah pembayaran berhasil
                            setTimeout(async () => {
                                try {
                                    const panelResponse = await fetch('/api/create-panel', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ 
                                            order_id: orderId,
                                            email: email, 
                                            panel_type: panelType 
                                        })
                                    });
                                    
                                    const panelData = await panelResponse.json();
                                    
                                    if (panelData.success) {
                                        statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Panel berhasil dibuat!';
                                        alert(\`✅ Panel berhasil dibuat!\\n\\n📧 Email: \${email}\\n📦 Panel: \${panelType.toUpperCase()}\\n🆔 Order ID: \${orderId}\\n\\nSilahkan cek email untuk informasi lebih lanjut.\`);
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
                    // Silent error
                }
            }

            // Close modal
            function closeModal() {
                document.getElementById('paymentModal').style.display = 'none';
                if (checkInterval) clearInterval(checkInterval);
            }

            // Initialize on page load
            document.addEventListener('DOMContentLoaded', function() {
                generatePriceCards();
                
                // Auto-play video
                const videos = document.querySelectorAll('video');
                videos.forEach(video => {
                    video.play().catch(e => {});
                });

                // Enter key untuk email modal
                document.getElementById('userEmail').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        submitEmail();
                    }
                });
            });
        </script>
    </body>
    </html>
`;
res.send(html);
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 START SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, HOST, () => {
console.log(`
\x1b[1m\x1b[34m╔═╗╦ ╦╦═╗╦ ╦╔╦╗╔═╗╔═╗╦  \x1b[0m
\x1b[1m\x1b[34m╠═╝╚╦╝╠╦╝║ ║ ║ ║╣ ╠═╝║  \x1b[0m
\x1b[1m\x1b[34m╩   ╩ ╩╚═╚═╝ ╩ ╚═╝╩  ╩═╝\x1b[0m
\x1b[1m\x1b[33mN O V A B O T   P A N E L   v${config.VERSI_WEB}\x1b[0m
\x1b[1m\x1b[32m═══════════════════════════════════════\x1b[0m
🌐 Server: http://${HOST}:${PORT}
👤 Developer: ${config.DEVELOPER}
📦 Version: ${config.VERSI_WEB}
✅ Server ready!
`);
});