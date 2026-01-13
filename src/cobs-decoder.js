/**
 * COBS (Consistent Overhead Byte Stuffing) Decoder
 * Implementation based on COBS encoding specification
 */
export class COBSDecoder {
    constructor() {
        // Initialize decoder state
    }

    /**
     * Decode COBS encoded data
     * @param {Uint8Array} encodedData - COBS encoded data
     * @returns {Uint8Array} - Decoded data
     */
    decode(encodedData) {
        if (!encodedData || encodedData.length === 0) {
            return new Uint8Array();
        }

        const decoded = [];
        let i = 0;

        while (i < encodedData.length) {
            const code = encodedData[i];
            
            if (code === 0) {
                // Unexpected zero byte in encoded data
                throw new Error('Invalid COBS encoding: unexpected zero byte');
            }

            // Copy the next (code-1) bytes directly
            for (let j = 1; j < code && (i + j) < encodedData.length; j++) {
                decoded.push(encodedData[i + j]);
            }

            // If code < 255, add a zero byte (unless we're at the end)
            if (code < 255 && (i + code) < encodedData.length) {
                decoded.push(0);
            }

            // Move to the next code byte
            i += code;
        }

        return new Uint8Array(decoded);
    }

    /**
     * Encode data using COBS encoding (for testing purposes)
     * @param {Uint8Array} data - Data to encode
     * @returns {Uint8Array} - COBS encoded data
     */
    encode(data) {
        if (!data || data.length === 0) {
            return new Uint8Array([1]); // Empty data encodes to single 0x01 byte
        }

        const encoded = [];
        let codeIndex = 0;
        let code = 1;

        encoded.push(0); // Placeholder for first code byte

        for (let i = 0; i < data.length; i++) {
            if (data[i] === 0) {
                // Found zero byte, finalize current block
                encoded[codeIndex] = code;
                codeIndex = encoded.length;
                encoded.push(0); // Placeholder for next code byte
                code = 1;
            } else {
                // Copy non-zero byte
                encoded.push(data[i]);
                code++;
                
                // Handle block size limit (254 bytes + 1 code byte = 255)
                if (code === 255) {
                    encoded[codeIndex] = code;
                    codeIndex = encoded.length;
                    encoded.push(0); // Placeholder for next code byte
                    code = 1;
                }
            }
        }

        // Finalize last block
        encoded[codeIndex] = code;

        return new Uint8Array(encoded);
    }
}