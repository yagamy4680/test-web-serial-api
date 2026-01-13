
# Web Serial COBS Decoder

A Node.js web application that connects to serial ports via the Web Serial API, reads streaming data, and decodes COBS-encoded MessagePack payloads.

## Features

- **Front-end**: Built with Bootstrap 5 and jQuery
- **Back-end**: Express.js server serving static files
- **Web Serial API**: Connect to serial devices directly from the browser
- **COBS Decoding**: Decode Consistent Overhead Byte Stuffing encoded data
- **MessagePack**: Decode binary MessagePack payloads
- **Real-time Display**: Stream hex data and decoded content in real-time

## Project Structure

```
testweb/
├── package.json              # Node.js dependencies and scripts
├── server.js                 # Express.js server
├── rspack.config.js          # Rspack bundler configuration
├── src/
│   ├── app.js               # Main application JavaScript
│   └── cobs-decoder.js      # COBS encoding/decoding implementation
├── public/
│   ├── index.html           # Main HTML page
│   └── js/                  # Built JavaScript files
└── README.md               # This file
```

## Prerequisites

- Node.js 16+ installed
- A browser that supports Web Serial API (Chrome 89+, Edge 89+)
- A serial device for testing (optional)

## Installation & Setup

1. **Install dependencies:**
   ```bash
   npm run install-deps
   ```

2. **Build the JavaScript bundle:**
   ```bash
   npm run build
   ```

3. **Start the development server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

4. **Open your browser and navigate to:**
   ```
   http://localhost:3000
   ```

## Usage

1. **Connect to Serial Port:**
   - Click "Connect to Serial Port" button
   - Select your serial device from the browser dialog
   - The app will connect using 9600 baud rate, 8 data bits, 1 stop bit, no parity

2. **View Data:**
   - **Raw Data**: See incoming bytes displayed in hexadecimal format
   - **Decoded Data**: View COBS-decoded and MessagePack-unpacked data
   - **Status**: Monitor connection status and any errors

3. **Clear Display:**
   - Use the "Clear" buttons to clear the raw or decoded data displays

## Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon
- `npm run build` - Build JavaScript bundle for production
- `npm run build:watch` - Build and watch for changes
- `npm run install-deps` - Install all dependencies

## Technical Details

### COBS (Consistent Overhead Byte Stuffing)
- Encodes data to eliminate zero bytes
- Uses delimiter byte (0x00) to separate packets
- Implemented in `src/cobs-decoder.js`

### MessagePack Integration
- Uses `msgpackr` library for binary data deserialization
- Loaded dynamically via CDN for browser compatibility
- Fallback to hex display if decoding fails

### Web Serial API
- Requires HTTPS or localhost for security
- Supports various baud rates and configurations
- Handles connection management and error recovery

## Browser Compatibility

- Chrome 89+
- Edge 89+
- Opera 76+
- (Firefox does not yet support Web Serial API)

## Development

To develop and build the application:

1. **Watch mode for automatic rebuilds:**
   ```bash
   npm run build:watch
   ```

2. **Development server with auto-restart:**
   ```bash
   npm run dev
   ```

3. **Production build:**
   ```bash
   npm run build
   ```

## License

ISC