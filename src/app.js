import { COBSDecoder } from './cobs-decoder.js';
import { unpack } from 'msgpackr';

// Check if Web Serial API is supported
if (!("serial" in navigator)) {
    alert("Web Serial API is not supported in this browser. Please use Chrome/Edge 89+ or similar.");
}

class SerialCOBSApp {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isReading = false;
        this.cobsDecoder = new COBSDecoder();
        this.buffer = new Uint8Array();
        
        this.initializeUI();
    }

    initializeUI() {
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');
        const clearRawBtn = document.getElementById('clearRawBtn');
        const clearDecodedBtn = document.getElementById('clearDecodedBtn');

        connectBtn.addEventListener('click', () => this.connectToSerial());
        disconnectBtn.addEventListener('click', () => this.disconnectFromSerial());
        clearRawBtn.addEventListener('click', () => this.clearRawData());
        clearDecodedBtn.addEventListener('click', () => this.clearDecodedData());

        this.updateConnectionStatus('Disconnected', 'secondary');
    }

    async connectToSerial() {
        try {
            // Request a port and open a connection
            this.port = await navigator.serial.requestPort();
            
            // Open the serial port with appropriate settings
            await this.port.open({
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                flowControl: "none"
            });

            this.updateConnectionStatus('Connected', 'success');
            this.logStatus('Connected to serial port');
            
            document.getElementById('connectBtn').disabled = true;
            document.getElementById('disconnectBtn').disabled = false;

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
            
            if (this.port) {
                await this.port.close();
                this.port = null;
            }

            this.updateConnectionStatus('Disconnected', 'secondary');
            this.logStatus('Disconnected from serial port');
            
            document.getElementById('connectBtn').disabled = false;
            document.getElementById('disconnectBtn').disabled = true;

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
        // Display raw hex data
        this.displayRawData(data);
        
        // Combine with existing buffer
        const newBuffer = new Uint8Array(this.buffer.length + data.length);
        newBuffer.set(this.buffer);
        newBuffer.set(data, this.buffer.length);
        this.buffer = newBuffer;

        // Process COBS packets
        this.processCOBSPackets();
    }

    processCOBSPackets() {
        let startIndex = 0;
        
        // Look for COBS packet delimiter (0x00)
        for (let i = 0; i < this.buffer.length; i++) {
            if (this.buffer[i] === 0x00) {
                // Found packet delimiter
                if (i > startIndex) {
                    const packetData = this.buffer.slice(startIndex, i);
                    this.decodeCOBSPacket(packetData);
                }
                startIndex = i + 1;
            }
        }

        // Keep remaining data in buffer
        if (startIndex < this.buffer.length) {
            this.buffer = this.buffer.slice(startIndex);
        } else {
            this.buffer = new Uint8Array();
        }
    }

    decodeCOBSPacket(encodedData) {
        try {
            const decodedData = this.cobsDecoder.decode(encodedData);
            if (decodedData.length > 0) {
                this.decodeMessagePack(decodedData);
            }
        } catch (error) {
            this.logError('COBS decode error: ' + error.message);
        }
    }

    decodeMessagePack(data) {
        try {
            const decoded = unpack(data);
            this.displayDecodedData(decoded);
        } catch (error) {
            this.logError('MessagePack decode error: ' + error.message);
            // Fallback: display raw decoded data as hex
            this.displayDecodedData('Raw data: ' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
    }

    displayRawData(data) {
        const hexString = Array.from(data).map(byte => 
            byte.toString(16).padStart(2, '0')
        ).join(' ');
        
        const display = document.getElementById('rawDataDisplay');
        const timestamp = new Date().toLocaleTimeString();
        display.innerHTML += `<div>[${timestamp}] ${hexString}</div>`;
        display.scrollTop = display.scrollHeight;
    }

    displayDecodedData(data) {
        const display = document.getElementById('decodedDataDisplay');
        const timestamp = new Date().toLocaleTimeString();
        const jsonString = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        display.innerHTML += `<div>[${timestamp}] ${jsonString}</div>`;
        display.scrollTop = display.scrollHeight;
    }

    logStatus(message) {
        const display = document.getElementById('statusDisplay');
        const timestamp = new Date().toLocaleTimeString();
        display.innerHTML += `<div>[${timestamp}] ${message}</div>`;
        display.scrollTop = display.scrollHeight;
    }

    logError(message) {
        const display = document.getElementById('statusDisplay');
        const timestamp = new Date().toLocaleTimeString();
        display.innerHTML += `<div class="error-message">[${timestamp}] ERROR: ${message}</div>`;
        display.scrollTop = display.scrollHeight;
    }

    updateConnectionStatus(status, type) {
        const statusElement = document.getElementById('connectionStatus');
        statusElement.textContent = status;
        statusElement.className = `ms-3 badge bg-${type}`;
    }

    clearRawData() {
        document.getElementById('rawDataDisplay').innerHTML = '';
    }

    clearDecodedData() {
        document.getElementById('decodedDataDisplay').innerHTML = '';
    }
}

// Initialize the application when DOM is ready
$(document).ready(() => {
    window.app = new SerialCOBSApp();
});