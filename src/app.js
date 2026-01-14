import { createStreamEncoder, createStreamDecoder } from 'ucobs';
import { pack, unpack } from 'msgpackr';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import crc8 from 'crc/crc8';
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

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
        
        // Statistics
        this.stats = {
            bytesReceived: 0,
            bytesSent: 0,
            packetsDecoded: 0,
            packetsSent: 0
        };
        
        // Initialize terminal
        this.terminal = new Terminal({
            fontSize: 12,
            fontFamily: 'Courier New, monospace',
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#00ff00',
                selection: '#404040'
            },
            cursorBlink: true,
            scrollback: 10000
        });
        
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        
        // uCOBS stream decoder for incoming data
        this.streamDecoder = createStreamDecoder(
            (chunk, isEnd) => this.handleDecodedChunk(chunk, isEnd),
            (error) => this.logError(`uCOBS decode error: ${error.message}`)
        );
        
        this.initializeUI();
    }

    initializeUI() {
        // Mount terminal
        this.terminal.open(document.getElementById('terminal'));
        this.fitAddon.fit();
        
        // Resize terminal on window resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
        });
        
        // Event listeners
        document.getElementById('connectBtn').addEventListener('click', () => this.connectToSerial());
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnectFromSerial());
        document.getElementById('clearTerminal').addEventListener('click', () => this.clearTerminal());
        document.getElementById('sendHexBtn').addEventListener('click', () => this.sendHexData());
        document.getElementById('sendJsonBtn').addEventListener('click', () => this.sendJsonData());
        
        // Enable/disable send buttons based on input
        document.getElementById('hexInput').addEventListener('input', () => this.updateSendButtons());
        document.getElementById('jsonInput').addEventListener('input', () => this.updateSendButtons());
        
        this.updateConnectionStatus('Disconnected', 'secondary');
        this.terminal.writeln(colorize.success('Serial Terminal Ready'));
        this.terminal.writeln('Connect to a serial port to begin communication.');
        this.terminal.writeln('');
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
            this.terminal.writeln(`${colorize.success('[CONNECTED]')} Serial port opened at ${baudRate} baud`);
            this.terminal.writeln('');
            
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('disconnectBtn').disabled = false;
            this.updateSendButtons();

            // Get writer for sending data
            this.writer = this.port.writable.getWriter();

            // Start reading data
            this.startReading();

            await this.sendHexString('05 11 91 10 84 00'); // Example initial command

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
                await this.reader.releaseLock();
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
            this.terminal.writeln(`${colorize.error('[DISCONNECTED]')} Serial port closed`);
            this.terminal.writeln('');
            
            document.getElementById('connectBtn').disabled = false;
            document.getElementById('disconnectBtn').disabled = true;
            this.updateSendButtons();

        } catch (error) {
            this.logError('Failed to disconnect: ' + error.message);
        }
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
        
        this.terminal.writeln(`${colorize.info('[RX]')} ${hexString}`);
        
        // Feed data to uCOBS stream decoder
        this.streamDecoder(data);
    }

    handleDecodedChunk(chunk, isEnd) {
        if (chunk.length > 0) {
            this.stats.packetsDecoded++;
            this.updateStats();
            
            // Display decoded hex
            const hexString = Array.from(chunk).map(byte => 
                byte.toString(16).padStart(2, '0').toUpperCase()
            ).join(' ');
            this.terminal.writeln(`${colorize.decoded('[DECODED]')} ${hexString}`);

            if (chunk.length < 3) {
                return this.terminal.writeln(`${colorize.warning('[RAW]')} Packet too short to process: ${hexString}`);
            }

            let packet_id = chunk[0];
            let checksum = chunk[chunk.length - 1];
            let payload = chunk.slice(1, chunk.length - 1);
            console.log('Processing packet ID:', packet_id, 'Checksum:', checksum, 'Payload:', payload);
            if (checksum != crc8(payload)) {
                return this.terminal.writeln(`${colorize.error('[ERROR]')} Checksum mismatch for packet ID ${packet_id}: expected ${crc8(payload).toString(16).toUpperCase().padStart(2,'0')}, got ${checksum.toString(16).toUpperCase().padStart(2,'0')}`);
            }
            
            // Try to decode as MessagePack
            this.decodeMessagePack(payload);
        }
    }

    decodeMessagePack(data) {
        try {
            const decoded = unpack(data);
            const jsonString = JSON.stringify(decoded);
            this.terminal.writeln(`${colorize.success('[JSON]')} ${jsonString}`);
        } catch (error) {
            // Not valid MessagePack, display as raw data
            this.terminal.writeln(`${colorize.warning('[RAW]')} Not MessagePack data`);
        }
        this.terminal.writeln('');
    }

    async sendHexString(hexString) {
        const hexBytes = hexString.split(/\s+/).map(hex => parseInt(hex, 16));
        const data = new Uint8Array(hexBytes);
        await this.sendEncodedChunk(data);
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
            await this.sendEncodedChunk(data, true);
            
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

    async sendRawData(data) {
        if (!this.writer) return;
        
        // Create a new uCOBS encoder for this data packet
        const [push, end] = createStreamEncoder(
            (chunk, isEnd) => this.sendEncodedChunk(chunk, isEnd),
            (error) => this.logError(`uCOBS encode error: ${error.message}`)
        );
        
        // Encode with uCOBS and send
        push(data);
        end(); // Signal end of this data packet
        
        this.stats.bytesSent += data.length;
        this.stats.packetsSent++;
        this.updateStats();
        
        // Display what we're sending
        const hexString = Array.from(data).map(byte => 
            byte.toString(16).padStart(2, '0').toUpperCase()
        ).join(' ');
        this.terminal.writeln(`${colorize.tx('[TX]')} ${hexString}`);
    }

    async sendEncodedChunk(chunk, isEnd) {
        if (this.writer && chunk.length > 0) {
            let buffer = new Uint8Array(chunk);
            console.log('Sending encoded chunk:', chunk, buffer);
            await this.writer.write(buffer);
            
            // Show encoded data being sent
            const hexString = Array.from(chunk).map(byte => 
                byte.toString(16).padStart(2, '0').toUpperCase()
            ).join(' ');
            this.terminal.writeln(`${colorize.muted('[TX-ENC]')} ${hexString}`);
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

    clearTerminal() {
        this.terminal.clear();
        this.terminal.writeln(colorize.success('Terminal cleared'));
        this.terminal.writeln('');
    }

    logError(message) {
        this.terminal.writeln(`${colorize.error('[ERROR]')} ${message}`);
        this.terminal.writeln('');
    }
}

// Initialize the application when DOM is ready
$(document).ready(() => {
    window.app = new SerialCOBSTerminal();
});