import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CobsMsgpackCodec } from './cobs-msgpack-codec.js';
import cbConstants from './cb.json' assert { type: 'json' };
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

// Utility function to get formatted timestamp
const getTimestamp = () => {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// Browser-compatible color utility inspired by yoctocolors
const colors = {
    // Reset
    reset: '\x1b[0m',

    // Basic colors
    black: (text) => `\x1b[30m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    magenta: (text) => `\x1b[35m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    white: (text) => `\x1b[37m${text}\x1b[0m`,
    gray: (text) => `\x1b[90m${text}\x1b[0m`,
    grey: (text) => `\x1b[90m${text}\x1b[0m`,

    // Bright colors
    blackBright: (text) => `\x1b[90m${text}\x1b[0m`,
    redBright: (text) => `\x1b[91m${text}\x1b[0m`,
    greenBright: (text) => `\x1b[92m${text}\x1b[0m`,
    yellowBright: (text) => `\x1b[93m${text}\x1b[0m`,
    blueBright: (text) => `\x1b[94m${text}\x1b[0m`,
    magentaBright: (text) => `\x1b[95m${text}\x1b[0m`,
    cyanBright: (text) => `\x1b[96m${text}\x1b[0m`,
    whiteBright: (text) => `\x1b[97m${text}\x1b[0m`,

    // Background colors
    bgBlack: (text) => `\x1b[40m${text}\x1b[0m`,
    bgRed: (text) => `\x1b[41m${text}\x1b[0m`,
    bgGreen: (text) => `\x1b[42m${text}\x1b[0m`,
    bgYellow: (text) => `\x1b[43m${text}\x1b[0m`,
    bgBlue: (text) => `\x1b[44m${text}\x1b[0m`,
    bgMagenta: (text) => `\x1b[45m${text}\x1b[0m`,
    bgCyan: (text) => `\x1b[46m${text}\x1b[0m`,
    bgWhite: (text) => `\x1b[47m${text}\x1b[0m`,

    // Modifiers
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    dim: (text) => `\x1b[2m${text}\x1b[22m`,
    italic: (text) => `\x1b[3m${text}\x1b[23m`,
    underline: (text) => `\x1b[4m${text}\x1b[24m`,
    strikethrough: (text) => `\x1b[9m${text}\x1b[29m`
};

// Application-specific color helpers
const colorize = {
    success: colors.green,
    error: colors.red,
    info: colors.blue,
    decoded: colors.cyan,
    tx: colors.magenta,
    warning: colors.yellow,
    muted: colors.gray
};

// Check if Web Serial API is supported
if (!("serial" in navigator)) {
    alert("Web Serial API is not supported in this browser. Please use Chrome/Edge 89+ or similar.");
}

class SerialCOBSTerminal {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isReading = false;
        this.codec = new CobsMsgpackCodec();
        this.codec.attach_encoder_callback(async (chunk) => await this.sendToSerial(chunk));
        this.codec.attach_decoder_callback(async (id, args) => await this.onPacket(id, args));

        // Statistics
        this.stats = {
            bytesReceived: 0,
            bytesSent: 0,
            packetsDecoded: 0,
            packetsSent: 0
        };

        // Status tracking
        this.status = {
            freeHeapSize: null,
            uptime: null,
            lastHeartbeat: null
        };

        this.heartbeatTimer = setInterval(async () => await this.onHeartbeatTmeout(), cbConstants.common_constants.MAX_HEARTBEAT_INTERVAL_MS);
        this.sensorTimer = setInterval(async () => await this.onSensorTimeout(), 1000);
        this.statusUpdateTimer = setInterval(() => this.updateStatusDisplay(), 1000); // Update status every second
        this.currentTimeTimer = setInterval(() => this.updateCurrentTime(), 1000); // Update current time every second

        // Initialize terminal
        this.debugTerminal = new Terminal({
            fontSize: 16,
            // fontFamily: 'Courier New, monospace',
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#00ff00',
                selection: '#404040'
            },
            cursorBlink: true,
            scrollback: 10000
        });

        // Initialize decoded arguments terminal
        this.responseTerminal = new Terminal({
            fontSize: 14,
            theme: {
                background: '#001122',
                foreground: '#00ffaa',
                cursor: '#00ff00',
                selection: '#404040'
            },
            cursorBlink: false,
            scrollback: 5000
        });

        this.fitAddon = new FitAddon();
        this.responseFitAddon = new FitAddon();
        this.debugTerminal.loadAddon(this.fitAddon);
        this.responseTerminal.loadAddon(this.responseFitAddon);

        this.boardInfoTypeMap = {};
        for (let key in cbConstants.board_info_types) {
            const value = cbConstants.board_info_types[key];
            this.boardInfoTypeMap[value.toString()] = key;
        }
        this.boardAttributeTypeMap = {};
        for (let key in cbConstants.board_attribute_types) {
            const value = cbConstants.board_attribute_types[key];
            this.boardAttributeTypeMap[value.toString()] = key;
        }

        // Initialize board info storage
        this.boardInfo = new Map();
        this.initializeBoardInfoTable();
        this.initializeUI();
    }

    initializeUI() {
        // Mount terminals
        this.responseTerminal.open(document.getElementById('decodedTerminal'));
        this.debugTerminal.open(document.getElementById('terminal'));
        this.responseFitAddon.fit();
        this.fitAddon.fit();

        // Resize terminals on window resize
        window.addEventListener('resize', () => {
            this.responseFitAddon.fit();
            this.fitAddon.fit();
        });

        // Event listeners
        document.getElementById('connectBtn').addEventListener('click', () => this.connectToSerial());
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnectFromSerial());
        document.getElementById('clearTerminal').addEventListener('click', () => this.clearTerminal());
        document.getElementById('clearDecodedTerminal').addEventListener('click', () => this.clearResponseTerminal());
        document.getElementById('clearBoardInfo').addEventListener('click', () => this.clearBoardInfoTable());
        document.getElementById('uploadBoardInfo').addEventListener('click', () => this.uploadBoardInfo());
        document.getElementById('sendHexBtn').addEventListener('click', () => this.sendHexData());
        document.getElementById('sendJsonBtn').addEventListener('click', () => this.sendJsonData());

        // Enable/disable send buttons based on input
        document.getElementById('hexInput').addEventListener('input', () => this.updateSendButtons());
        document.getElementById('jsonInput').addEventListener('input', () => this.updateSendButtons());

        // Debug terminal visibility toggle
        document.getElementById('showDebugTerminal').addEventListener('change', (e) => {
            const debugCard = document.getElementById('debugTerminalCard');
            debugCard.style.display = e.target.checked ? 'block' : 'none';
            // Refit terminals when visibility changes
            setTimeout(() => {
                this.responseFitAddon.fit();
                if (e.target.checked) this.fitAddon.fit();
            }, 100);
        });

        // Send data panel visibility toggle
        document.getElementById('showSendDataPanel').addEventListener('change', (e) => {
            const sendDataCard = document.getElementById('sendDataCard');
            sendDataCard.style.display = e.target.checked ? 'block' : 'none';
            // Update send buttons when panel visibility changes
            this.updateSendButtons();
        });

        this.updateConnectionStatus('Disconnected', 'secondary');
        this.terminal_println(`${colorize.success('Serial Terminal Ready')}`);
        this.terminal_println(`Connect to a serial port to begin communication.`);
        this.terminal_println('');

        // Initialize board info table
        this.initializeBoardInfoTable();

        // Initialize upload button state
        this.updateUploadButton();

        // Initialize status display
        this.updateStatusDisplay();

        // Initialize current time display
        this.updateCurrentTime();
    }

    async connectToSerial() {
        try {
            // Check if CB1e filter is enabled
            const cb1eFilter = document.getElementById('cb1eFilter').checked;

            let requestOptions = {};
            if (cb1eFilter) {
                // Filter for CB1e USB devices (vendor ID 0x303a)
                requestOptions = {
                    filters: [{
                        usbVendorId: 0x303a
                    }]
                };
            }

            // Request a port and open a connection
            this.port = await navigator.serial.requestPort(requestOptions);
            window.serial_port = this.port; // For debugging

            const baudRate = parseInt(document.getElementById('baudRate').value);

            // Open the serial port with user-selected baud rate
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                flowControl: "none"
            });

            this.updateConnectionStatus('Connected', 'success');
            this.responseTerminal.clear();
            this.debugTerminal.clear();
            this.terminal_println(`${colorize.success('[CONNECTED]')} Serial port opened at ${baudRate} baud`);
            this.terminal_println('');

            document.getElementById('connectBtn').disabled = true;
            document.getElementById('disconnectBtn').disabled = false;
            this.updateSendButtons();

            // Get writer for sending data
            this.writer = this.port.writable.getWriter();

            // Add event listeners for serial port connect/disconnect
            this.setupSerialEventListeners();

            // Start reading data
            setTimeout(async () => this.startReading(), 10);

            await this.fetchInfoFromDevice();

        } catch (error) {
            this.logError('Failed to connect: ' + error.message);
            this.updateConnectionStatus('Error', 'danger');
        }
    }

    async disconnectFromSerial() {
        try {
            this.isReading = false;

            if (this.reader) {
                await this.reader.cancel();
                if (this.reader) { await this.reader.releaseLock(); }
                this.reader = null;
            }

            if (this.writer) {
                await this.writer.releaseLock();
                this.writer = null;
            }

            if (this.port) {
                await this.port.close();
                this.port = null;
            }

            this.updateConnectionStatus('Disconnected', 'secondary');
            this.terminal_println(`${colorize.error('[DISCONNECTED]')} Serial port closed`);
            this.terminal_println('');

            document.getElementById('connectBtn').disabled = false;
            document.getElementById('disconnectBtn').disabled = true;
            this.updateSendButtons();

            // Clear status when disconnected
            this.status.freeHeapSize = null;
            this.status.uptime = null;
            this.status.lastHeartbeat = null;
            this.updateStatusDisplay();

        } catch (error) {
            this.logError('Failed to disconnect: ' + error.message);
            console.log(error);
        }
    }

    async fetchInfoFromDevice() {
        if (!this.port) return;
        try {
            // await this.sendHexString('05 11 91 10 84 00'); // Example initial command
            let keys = Object.keys(cbConstants.board_info_types);
            for (let i = 0; i < keys.length; i++) {
                let key = keys[i];
                let value = cbConstants.board_info_types[key];
                this.codec.push_arguments(cbConstants.common_packet_ids.PKTID_H2B_COMMON_GET_INFO, [value]);
                await sleep(100);
            }
        } catch (error) {
            console.log(error);
            this.logError('Failed to connect: ' + error.message);
            this.updateConnectionStatus('Error', 'danger');
        }
    }

    setupSerialEventListeners() {
        if (!this.port) return;

        // Listen for connect events
        this.port.addEventListener('connect', () => {
            this.terminal_println(`${colorize.success('[DEVICE CONNECTED]')} Serial device reconnected`);
            this.terminal_println('');
            this.updateConnectionStatus('Connected', 'success');

            // Re-enable functionality
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('disconnectBtn').disabled = false;
            this.updateSendButtons();
        });

        // Listen for disconnect events  
        this.port.addEventListener('disconnect', () => {
            this.terminal_println(`${colorize.warning('[DEVICE DISCONNECTED]')} Serial device unplugged or connection lost`);
            this.terminal_println('');
            this.updateConnectionStatus('Disconnected', 'warning');

            // Clean up and disable functionality
            this.handleUnexpectedDisconnect();
        });
    }

    handleUnexpectedDisconnect() {
        // Stop reading if still active
        this.isReading = false;

        // Clean up resources
        if (this.reader) {
            this.reader.releaseLock().catch(() => { });
            this.reader = null;
        }

        if (this.writer) {
            this.writer.releaseLock().catch(() => { });
            this.writer = null;
        }

        // Update UI state
        document.getElementById('connectBtn').disabled = false;
        document.getElementById('disconnectBtn').disabled = true;
        this.updateSendButtons();

        // Reset port reference
        this.port = null;

        this.terminal_println(`${colorize.info('[INFO]')} Click 'Connect' to establish a new connection`);
        this.terminal_println('');
    }

    async startReading() {
        if (!this.port) return;

        this.isReading = true;
        this.reader = this.port.readable.getReader();

        try {
            while (this.isReading) {
                const { value, done } = await this.reader.read();
                if (done) break;

                if (value) {
                    this.processIncomingData(value);
                }
            }
        } catch (error) {
            if (this.isReading) {
                this.logError('Read error: ' + error.message);
            }
        } finally {
            if (this.reader) {
                this.reader.releaseLock();
                this.reader = null;
            }
        }
    }

    processIncomingData(data) {
        this.stats.bytesReceived += data.length;
        this.updateStats();

        // Display raw hex data
        const hexString = Array.from(data).map(byte =>
            byte.toString(16).padStart(2, '0').toUpperCase()
        ).join(' ');

        this.terminal_println(`USB/CDC => ${colors.yellow(hexString)}`);

        // Feed data to uCOBS/MessagePack stream decoder
        this.codec.push_raw_bytes(data);
    }

    async sendHexData() {
        const hexInput = document.getElementById('hexInput').value.trim();
        if (!hexInput || !this.writer) return;

        try {
            // Parse hex string
            console.log('Hex input to parse:', hexInput);
            const hexBytes = hexInput.split(/\s+/).map(hex => {
                const byte = parseInt(hex, 16);
                if (isNaN(byte) || byte < 0 || byte > 255) {
                    throw new Error(`Invalid hex byte: ${hex}`);
                }
                return byte;
            });
            console.log('Parsed hex bytes:', hexBytes);
            const hexes = hexBytes.map(b => b.toString(16).padStart(2, '0')).join('');
            console.log('Hex string to send:', hexes);
            const data = new Uint8Array(hexBytes);
            console.log('Uint8Array data to send:', data);
            // await this.sendRawData(data);
            await this.sendToSerial(data, true);

            // Clear input
            document.getElementById('hexInput').value = '';
            this.updateSendButtons();

        } catch (error) {
            this.logError('Failed to send hex data: ' + error.message);
        }
    }

    async sendJsonData() {
        const jsonInput = document.getElementById('jsonInput').value.trim();
        if (!jsonInput || !this.writer) return;

        try {
            // Parse and pack JSON as MessagePack
            const jsonData = JSON.parse(jsonInput);
            const packedData = pack(jsonData);

            await this.sendRawData(packedData);

            // Clear input
            document.getElementById('jsonInput').value = '';
            this.updateSendButtons();

        } catch (error) {
            this.logError('Failed to send JSON data: ' + error.message);
        }
    }

    async sendToSerial(chunk, isEnd = false) {
        if (this.writer && chunk.length > 0) {
            let buffer = new Uint8Array(chunk);
            // console.log('Sending encoded chunk:', chunk, buffer);
            await this.writer.write(buffer);

            this.stats.bytesSent += chunk.length;
            this.stats.packetsSent++;

            // Show encoded data being sent
            const hexString = Array.from(chunk).map(byte =>
                byte.toString(16).padStart(2, '0').toUpperCase()
            ).join(' ');
            this.terminal_println(`USB/CDC <= ${colorize.tx(hexString)}`);
        }
    }

    updateSendButtons() {
        const isConnected = this.port !== null;
        const hasHexInput = document.getElementById('hexInput').value.trim().length > 0;
        const hasJsonInput = document.getElementById('jsonInput').value.trim().length > 0;

        document.getElementById('sendHexBtn').disabled = !isConnected || !hasHexInput;
        document.getElementById('sendJsonBtn').disabled = !isConnected || !hasJsonInput;
    }

    updateConnectionStatus(status, type) {
        const statusElement = document.getElementById('connectionStatus');
        statusElement.textContent = status;
        statusElement.className = `badge bg-${type} status-badge`;
    }

    updateStats() {
        document.getElementById('bytesReceived').textContent = this.stats.bytesReceived;
        document.getElementById('bytesSent').textContent = this.stats.bytesSent;
        document.getElementById('packetsDecoded').textContent = this.stats.packetsDecoded;
        document.getElementById('packetsSent').textContent = this.stats.packetsSent;
    }

    updateStatusDisplay() {
        // Update free heap size
        const heapElement = document.getElementById('freeHeapSize');
        if (heapElement) {
            if (this.status.freeHeapSize !== null) {
                heapElement.textContent = `${this.status.freeHeapSize.toLocaleString()} bytes`;
                heapElement.className = 'badge bg-success';
            } else {
                heapElement.textContent = 'N/A';
                heapElement.className = 'badge bg-secondary';
            }
        }

        // Update uptime
        const uptimeElement = document.getElementById('uptime');
        if (uptimeElement) {
            if (this.status.uptime !== null) {
                const uptimeSeconds = (this.status.uptime / 1000).toFixed(2);
                uptimeElement.textContent = `${uptimeSeconds}s`;
                uptimeElement.className = 'badge bg-primary';
            } else {
                uptimeElement.textContent = 'N/A';
                uptimeElement.className = 'badge bg-secondary';
            }
        }

        // Update last heartbeat indicator
        const heartbeatElement = document.getElementById('lastHeartbeat');
        if (heartbeatElement) {
            if (this.status.lastHeartbeat !== null) {
                const timeSinceHeartbeat = Date.now() - this.status.lastHeartbeat;
                if (timeSinceHeartbeat < 5000) { // Less than 5 seconds
                    heartbeatElement.textContent = 'Online';
                    heartbeatElement.className = 'badge bg-success';
                } else if (timeSinceHeartbeat < 10000) { // Less than 10 seconds
                    heartbeatElement.textContent = 'Warning';
                    heartbeatElement.className = 'badge bg-warning';
                } else {
                    heartbeatElement.textContent = 'Offline';
                    heartbeatElement.className = 'badge bg-danger';
                }
            } else {
                heartbeatElement.textContent = 'N/A';
                heartbeatElement.className = 'badge bg-secondary';
            }
        }
    }

    updateCurrentTime() {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        
        const timeString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        
        // Update all current time displays
        const timeElements = document.querySelectorAll('.current-time');
        timeElements.forEach(element => {
            element.textContent = timeString;
        });
    }

    // Centralized terminal output with timestamp
    terminal_println(message) {
        if (message === '') {
            this.debugTerminal.writeln('');
        } else {
            this.debugTerminal.writeln(`[${getTimestamp()}] ${message}`);
        }
    }

    // Centralized decoded terminal output with timestamp
    response_terminal_println(message) {
        if (message === '') {
            this.responseTerminal.writeln('');
        } else {
            this.responseTerminal.writeln(`[${getTimestamp()}] ${message}`);
        }
    }

    clearTerminal() {
        this.debugTerminal.clear();
        this.terminal_println(`${colorize.success('Terminal cleared')}`);
        this.terminal_println('');
    }

    clearResponseTerminal() {
        this.responseTerminal.clear();
        this.response_terminal_println(`${colorize.success('Response terminal cleared')}`);
    }

    initializeBoardInfoTable() {
        // Pre-populate table with all board info types
        Object.keys(cbConstants.board_info_types).forEach(infoTypeName => {
            this.updateBoardInfoTable(infoTypeName, 'Pending...', 'secondary');
        });
    }

    updateBoardInfoTable(infoType, value, status) {
        infoType = infoType.replace('BOARD_INFO_TTCB_', '');
        // console.log(`Updated board info table: ${infoType} = ${value} (${status})`);

        const tableBody = document.getElementById('boardInfoTableBody');
        const rowId = `boardInfo-${infoType}`;
        let row = document.getElementById(rowId);

        if (!row) {
            row = document.createElement('tr');
            row.id = rowId;
            tableBody.appendChild(row);
        }

        const statusClass = {
            'success': 'text-success',
            'danger': 'text-danger',
            'secondary': 'text-muted'
        }[status] || 'text-muted';

        const statusIcon = {
            'success': '✓',
            'danger': '✗',
            'secondary': '⏳'
        }[status] || '⏳';

        row.innerHTML = `
            <td><small>${infoType}</small></td>
            <td><code class="${statusClass}">${value}</code></td>
            <td><span class="${statusClass}">${statusIcon}</span></td>
        `;

        // Store the info for future reference
        this.boardInfo.set(infoType.toLowerCase(), { value, status });

        // Update upload button state
        this.updateUploadButton();
    }

    updateUploadButton() {
        const uploadBtn = document.getElementById('uploadBoardInfo');
        const macAddressRow = this.boardInfo.get('bluetooth_mac_address');

        // console.log('Updating upload button. MAC address row:', macAddressRow);

        // Enable upload button if we have MAC address and it's valid
        const hasValidMac = macAddressRow &&
            macAddressRow.status === 'success' &&
            macAddressRow.value !== 'ERROR' &&
            macAddressRow.value !== 'Pending...';

        // console.log('Has valid MAC:', hasValidMac);
        uploadBtn.disabled = !hasValidMac;
        // console.log('Upload button disabled:', uploadBtn.disabled);
    }

    async uploadBoardInfo() {
        console.log('Upload button clicked!');
        const annotation = document.getElementById('annotationInput').value.trim();
        const statusDiv = document.getElementById('uploadStatus');
        const uploadBtn = document.getElementById('uploadBoardInfo');

        console.log('Current board info:', this.boardInfo);

        // Show status div
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = '<small class="text-primary">Uploading...</small>';
        uploadBtn.disabled = true;

        try {
            // Prepare board info data
            const boardData = {};
            this.boardInfo.forEach((info, type) => {
                if (info.status === 'success' && info.value !== 'ERROR' && info.value !== 'Pending...') {
                    boardData[type] = info.value;
                }
            });

            console.log('Prepared board data:', boardData);

            // Prepare upload payload
            const uploadData = {
                boardInfo: boardData,
                annotation: annotation || '',
                timestamp: new Date().toISOString()
            };

            console.log('Upload payload:', uploadData);

            // Send to server
            const response = await fetch('/api/upload-board-info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(uploadData)
            });

            console.log('Response status:', response.status);
            const result = await response.json();
            console.log('Response data:', result);

            if (response.ok) {
                statusDiv.innerHTML = `<small class="text-success">✓ Uploaded: ${result.filename}</small>`;
                // Clear annotation
                document.getElementById('annotationInput').value = '';

                this.terminal_println(`${colorize.success('[SUCCESS]')} Board info uploaded: ${result.filename}`);
            } else {
                throw new Error(result.error || 'Upload failed');
            }
        } catch (error) {
            console.error('Upload error:', error);
            statusDiv.innerHTML = `<small class="text-danger">✗ Error: ${error.message}</small>`;
            this.terminal_println(`${colorize.error('[ERROR]')} Upload failed: ${error.message}`);
            console.error('Upload error:', error);
        } finally {
            // Re-enable upload button after a delay
            setTimeout(() => {
                this.updateUploadButton();
            }, 1000);
        }
    }

    clearBoardInfoTable() {
        const tableBody = document.getElementById('boardInfoTableBody');
        tableBody.innerHTML = '';
        this.boardInfo.clear();
        this.initializeBoardInfoTable();

        // Update upload button state (will be disabled when board info is cleared)
        this.updateUploadButton();

        // Hide upload status
        const statusDiv = document.getElementById('uploadStatus');
        statusDiv.style.display = 'none';
    }

    initializeBoardInfoTable() {
        // Pre-populate table with all board info types
        Object.keys(cbConstants.board_info_types).forEach(infoTypeName => {
            this.updateBoardInfoTable(infoTypeName, 'Pending...', 'secondary');
        });
    }

    clearBoardInfoTable() {
        const tableBody = document.getElementById('boardInfoTableBody');
        tableBody.innerHTML = '';
        this.boardInfo.clear();
        this.initializeBoardInfoTable();
    }

    logError(message) {
        this.terminal_println(`${colorize.error('[ERROR]')} ${message}`);
        this.terminal_println('');
    }


    async onHeartbeatTmeout() {
        const { PKTID_HEARTBEAT } = cbConstants.common_packet_ids;
        if (this.port && this.isReading) {
            // Send heartbeat packet
            this.codec.push_arguments(PKTID_HEARTBEAT, [Date.now()]);
            // this.terminal_println(`${colorize.info('[HEARTBEAT]')} Sent heartbeat packet`);
        }
    }

    async onSensorTimeout() {
        const { PKTID_H2B_COMMON_GET_ATTRIBUTE } = cbConstants.common_packet_ids;
        const { BOARD_ATTR_TTCB_COMMON_FREE_HEAP_SIZE } = cbConstants.board_attribute_types;
        if (this.port && this.isReading) {
            this.codec.push_arguments(PKTID_H2B_COMMON_GET_ATTRIBUTE, [BOARD_ATTR_TTCB_COMMON_FREE_HEAP_SIZE]);
        }
    }

    async onPacket(id, args) {
        let { common_packet_ids } = cbConstants;
        let { PKT_RSP_OK } = cbConstants.common_response_codes;
        let dumped = true;
        this.stats.packetsDecoded++;
        // console.log('Decoded arguments from codec:', id, args);
        if (id == common_packet_ids.PKTID_B2H_COMMON_GET_INFO_RSP) {
            const rsp = args[0];
            const infoType = args[1];
            const infoValue = args[2];
            const infoTypeName = this.boardInfoTypeMap[infoType.toString()] || 'UNKNOWN';

            if (rsp != PKT_RSP_OK) {
                this.updateBoardInfoTable(infoTypeName, 'ERROR', 'danger');
                this.terminal_println(`${colors.red('Error:')} Board Info request failed for ${infoTypeName} with code ${rsp}`);
            }
            else {
                console.log('Received board info:', infoTypeName, infoValue);
                this.updateBoardInfoTable(infoTypeName, infoValue, 'success');
                // this.terminal_println(`${colors.white('Board Info:')} ${colors.yellow(infoTypeName)} = ${colors.green(infoValue)}`);
            }
        }
        else if (id == common_packet_ids.PKTID_B2H_COMMON_GET_ATTRIBUTE_RSP) {
            const rsp = args[0];
            const infoType = args[1];
            const infoValue = args[2];
            const infoTypeName = this.boardAttributeTypeMap[infoType.toString()] || 'UNKNOWN';
            if (rsp != PKT_RSP_OK) {
                console.warn(`Received error response for attribute ${infoTypeName}: code ${rsp}`);
            }
            else {
                // console.log(`Received attribute ${infoTypeName}: value ${infoValue}`);
                if (infoType == cbConstants.board_attribute_types.BOARD_ATTR_TTCB_COMMON_FREE_HEAP_SIZE) {
                    // console.log(`Free heap size: ${infoValue} bytes`);
                    this.status.freeHeapSize = infoValue;
                    this.updateStatusDisplay();
                }
                else {
                    // console.log(`Received attribute ${infoTypeName}: value ${infoValue}`);
                }
            }
        }
        else if (id == common_packet_ids.PKTID_HEARTBEAT) {
            dumped = false;
            const uptime = args[0];
            this.status.uptime = uptime;
            this.status.lastHeartbeat = Date.now();
            this.updateStatusDisplay();
            // this.terminal_println(`${colorize.info('[HEARTBEAT]')} Uptime: ${uptime} ms`);
        }
        else {
            this.terminal_println(`${colors.yellow('Warning:')} Unhandled packet ID ${id} with args: ${JSON.stringify(args)}`);
        }
        if (dumped) {
            const jsonString = JSON.stringify({ id: id, args: args });
            this.response_terminal_println(`${colors.white('USB/CDC')} => ${jsonString}`);
        }
    }

}

// Initialize the application when DOM is ready
$(document).ready(() => {
    window.app = new SerialCOBSTerminal();
});