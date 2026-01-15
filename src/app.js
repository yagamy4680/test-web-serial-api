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
        this.codec.attach_encoder_callback((chunk) => {
            console.log('Encoded chunk from codec:', chunk);
            this.sendToSerial(chunk, false);
        });
        this.codec.attach_decoder_callback((id, argsArray) => {
            this.stats.packetsDecoded++;
            console.log('Decoded arguments from codec:', id, argsArray);
            const jsonString = JSON.stringify({ id: id, args: argsArray });
            this.response_terminal_println(`${colors.white('USB/CDC')} => ${jsonString}`);
            if (id == cbConstants.common_packet_ids.PKTID_B2H_COMMON_GET_INFO_RSP) {
                const rsp = argsArray[0];
                const infoType = argsArray[1];
                const infoValue = argsArray[2];
                const infoTypeName = this.boardInfoTypeMap[infoType.toString()] || 'UNKNOWN';

                if (rsp != cbConstants.common_response_codes.PKT_RSP_OK) {
                    this.updateBoardInfoTable(infoTypeName, 'ERROR', 'danger');
                    this.terminal_println(`${colors.red('Error:')} Board Info request failed for ${infoTypeName} with code ${rsp}`);
                    return;
                }

                this.updateBoardInfoTable(infoTypeName, infoValue, 'success');
                // this.terminal_println(`${colors.white('Board Info:')} ${colors.yellow(infoTypeName)} = ${colors.green(infoValue)}`);
                return;
            }
        });

        // Statistics
        this.stats = {
            bytesReceived: 0,
            bytesSent: 0,
            packetsDecoded: 0,
            packetsSent: 0
        };

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

    async sendToSerial(chunk, isEnd) {
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
        this.boardInfo.set(infoType, { value, status });
    }

    clearBoardInfoTable() {
        const tableBody = document.getElementById('boardInfoTableBody');
        tableBody.innerHTML = '';
        this.boardInfo.clear();
        this.initializeBoardInfoTable();
    }

    initializeBoardInfoTable() {
        // Pre-populate table with all board info types
        Object.keys(cbConstants.board_info_types).forEach(infoTypeName => {
            this.updateBoardInfoTable(infoTypeName, 'Pending...', 'secondary');
        });
    }

    updateBoardInfoTable(infoType, value, status) {
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

        // Remove the BOARD_INFO_TTCB_ prefix for display
        const displayName = infoType.replace('BOARD_INFO_TTCB_', '');

        row.innerHTML = `
            <td><small>${displayName}</small></td>
            <td><code class="${statusClass}">${value}</code></td>
            <td><span class="${statusClass}">${statusIcon}</span></td>
        `;

        // Store the info for future reference
        this.boardInfo.set(infoType, { value, status });
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
}

// Initialize the application when DOM is ready
$(document).ready(() => {
    window.app = new SerialCOBSTerminal();
});