import { createStreamEncoder, createStreamDecoder } from 'ucobs';
import { pack, unpack } from 'msgpackr';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

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
        
        // uCOBS stream encoder for outgoing data  
        this.streamEncoder = createStreamEncoder(
            (chunk, isEnd) => this.sendEncodedChunk(chunk, isEnd),
            (error) => this.logError(`uCOBS encode error: ${error.message}`)
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
        this.terminal.writeln('\\x1b[32mSerial Terminal Ready\\x1b[0m');
        this.terminal.writeln('Connect to a serial port to begin communication.');
        this.terminal.writeln('');
    }

    async connectToSerial() {
        try {
            // Request a port and open a connection
            this.port = await navigator.serial.requestPort();
            
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
            this.terminal.writeln(`\\x1b[32m[CONNECTED]\\x1b[0m Serial port opened at ${baudRate} baud`);
            this.terminal.writeln('');
            
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('disconnectBtn').disabled = false;
            this.updateSendButtons();

            // Get writer for sending data
            this.writer = this.port.writable.getWriter();

            // Start reading data
            this.startReading();

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
            this.terminal.writeln(`\\x1b[31m[DISCONNECTED]\\x1b[0m Serial port closed`);
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
        
        this.terminal.writeln(`\\x1b[34m[RX]\\x1b[0m ${hexString}`);
        
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
            this.terminal.writeln(`\\x1b[36m[DECODED]\\x1b[0m ${hexString}`);
            
            // Try to decode as MessagePack
            this.decodeMessagePack(chunk);
        }
    }

    decodeMessagePack(data) {
        try {
            const decoded = unpack(data);
            const jsonString = JSON.stringify(decoded, null, 2);
            this.terminal.writeln(`\\x1b[32m[JSON]\\x1b[0m ${jsonString}`);
        } catch (error) {
            // Not valid MessagePack, display as raw data
            this.terminal.writeln(`\\x1b[33m[RAW]\\x1b[0m Not MessagePack data`);
        }
        this.terminal.writeln('');
    }

    async sendHexData() {
        const hexInput = document.getElementById('hexInput').value.trim();
        if (!hexInput || !this.writer) return;
        
        try {
            // Parse hex string
            const hexBytes = hexInput.split(/\\s+/).map(hex => {
                const byte = parseInt(hex, 16);
                if (isNaN(byte) || byte < 0 || byte > 255) {
                    throw new Error(`Invalid hex byte: ${hex}`);
                }
                return byte;
            });
            
            const data = new Uint8Array(hexBytes);
            await this.sendRawData(data);
            
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
        
        // Encode with uCOBS and send
        this.streamEncoder(data);
        
        this.stats.bytesSent += data.length;
        this.stats.packetsSent++;
        this.updateStats();
        
        // Display what we're sending
        const hexString = Array.from(data).map(byte => 
            byte.toString(16).padStart(2, '0').toUpperCase()
        ).join(' ');
        this.terminal.writeln(`\\x1b[35m[TX]\\x1b[0m ${hexString}`);
    }

    async sendEncodedChunk(chunk, isEnd) {
        if (this.writer && chunk.length > 0) {
            await this.writer.write(chunk);
            
            // Show encoded data being sent
            const hexString = Array.from(chunk).map(byte => 
                byte.toString(16).padStart(2, '0').toUpperCase()
            ).join(' ');
            this.terminal.writeln(`\\x1b[90m[TX-ENC]\\x1b[0m ${hexString}`);
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
        this.terminal.writeln('\\x1b[32mTerminal cleared\\x1b[0m');
        this.terminal.writeln('');
    }

    logError(message) {
        this.terminal.writeln(`\\x1b[31m[ERROR]\\x1b[0m ${message}`);
        this.terminal.writeln('');
    }
}

// Initialize the application when DOM is ready
$(document).ready(() => {
    window.app = new SerialCOBSTerminal();
});