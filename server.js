const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Default work directory - can be overridden with WORK_DIR environment variable
const WORK_DIR = process.env.WORK_DIR || '/tmp';

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// Ensure work directory exists
if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    console.log(`Created work directory: ${WORK_DIR}`);
}

// Sample route that serves the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint (can be expanded for future use)
app.get('/api/status', (req, res) => {
    res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// API endpoint to upload board information
app.post('/api/upload-board-info', (req, res) => {
    try {
        console.log('Received board information upload request', req.body);
        const { boardInfo, annotation } = req.body;
        
        if (!boardInfo || typeof boardInfo !== 'object') {
            return res.status(400).json({ error: 'Invalid board information data' });
        }

        // Extract MAC address (look for various MAC address types)
        let macAddress = boardInfo['bluetooth_mac_address'];
        if (!macAddress) {
            return res.status(400).json({ error: 'MAC address not found in board information' });
        }
        macAddress = macAddress.split(':').join('').toUpperCase();

        // Generate filename with timestamp
        const now = new Date();
        const dateStr = now.getFullYear().toString() + 
                       (now.getMonth() + 1).toString().padStart(2, '0') + 
                       now.getDate().toString().padStart(2, '0');
        const timeStr = now.getHours().toString().padStart(2, '0') + 
                       now.getMinutes().toString().padStart(2, '0');
        
        const filename = `cb1e-${macAddress}-${dateStr}-${timeStr}.json`;
        const filepath = path.join(WORK_DIR, filename);

        // Prepare data to save
        const dataToSave = {
            timestamp: now.toISOString(),
            annotation: annotation || '',
            boardInfo: boardInfo
        };

        // Write file
        fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2));
        
        console.log(`Board information saved to: ${filepath}`);
        
        res.json({ 
            success: true, 
            filename: filename,
            filepath: filepath,
            message: 'Board information uploaded successfully'
        });

    } catch (error) {
        console.error('Error saving board information:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Work directory: ${WORK_DIR}`);
    console.log('Press Ctrl+C to stop the server');
});