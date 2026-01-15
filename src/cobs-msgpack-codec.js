/**
 * Copyright (c) 2019-2023 T2T Inc. All rights reserved
 * 
 *  https://www.t2t.io
 *  https://tic-tac-toe.io
 * 
 * Taipei, Taiwan
 */
'use strict';

import { createBlockEncoder, createStreamDecoder } from 'ucobs';
import { pack, unpack } from 'msgpackr';
import crc8 from 'crc/crc8';

/**
 * Payload format:
 * 
 *  [id byte] [msgpack-encoded bytes for one array of arguments] [crc8 checksum byte]
 * 
 *  where:
 *  - id, the identity byte, is an unsigned 8-bit integer
 *  - msgpack-encoded bytes represent an array of arguments encoded using MessagePack
 *  - crc8 checksum byte is computed over the preceding bytes (id + msgpack bytes)
 * 
 * Example:
 *  [0x10] [0x93 0x01 0x02 0x03] [0xA5]
 *      Here, 0x10 is the id byte, 0x93 0x01 0x02 0x03 is the MessagePack encoding of the array [1, 2, 3],
 *      and 0xA5 is the CRC8 checksum byte.
 * 
 *  0x12 0x93 0x00 0x10 0xA4 0x63 0x62 0x31 0x65 0xF3
 *      Here, 0x12 is the id byte, 0x93 0x00 0x10 0xA4 0x63 0x62 0x31 0x65 is the MessagePack encoding of 
 *      the array [0, 16, "cb1e"], and 0xF3 is the CRC8 checksum byte.
 * 
 * The payload bytes are then COBS encoded for transmission.
 */

export function to_hex(byteArray, delimiter = '') {
    return Array.from(byteArray, byte => {
        return ('0' + (byte & 0xFF).toString(16)).toUpperCase().slice(-2);
    }).join(delimiter);
}


export class CobsMsgpackCodec {
    constructor() {
        this.encode = createBlockEncoder((encoded) => this.on_encoded_chunk(encoded));
        this.decode = createStreamDecoder((decoded, isEnd) => this.on_decoded_chunk(decoded, isEnd));
        this.encoder_callback = null;
        this.decoder_callback = null;
    }

    attach_encoder_callback(encoder_callback) {
        this.encoder_callback = encoder_callback;
    }

    attach_decoder_callback(decoder_callback) {
        this.decoder_callback = decoder_callback;
    }

    /**
     * Push arguments with given id to encoder
     * 
     * @param {*} id        the identity byte, from 0 to 255
     * @param {*} argsArray array of arguments to be encoded
     */
    push_arguments(id, argsArray) {
        // Create payload: [id byte] + msgpack-encoded args + crc8 checksum
        const msgpackBytes = pack(argsArray);
        const payloadLength = 1 + msgpackBytes.length + 1;
        const payload = new Uint8Array(payloadLength);

        payload[0] = id & 0xFF; // only the least significant byte
        payload.set(msgpackBytes, 1);

        // Compute CRC8 checksum
        const checksum = crc8(msgpackBytes);
        payload[payloadLength - 1] = checksum;
        console.log(`Payload before COBS encoding: ${to_hex(payload, '.')}`);

        // COBS encode the payload, which is emitted via encoder_push callback
        this.encode(payload);
    }

    /**
     * Push raw COBS encoded bytes to decoder
     */
    push_raw_bytes(rawBytes) {
        this.decode(rawBytes);
    }

    on_encoded_chunk(encoded) {
        console.log(`COBS Encoded chunk: ${to_hex(encoded, '.')}`);
        if (this.encoder_callback) {
            this.encoder_callback(encoded);
        }
    }

    on_decoded_chunk(decoded, isEnd) {
        console.log(`COBS Decoded chunk: ${to_hex(decoded, '.')}, isEnd: ${isEnd}`);

        if (decoded.length < 3) {
            console.warn('Decoded data too short to contain valid payload');
            return;
        }

        const id = decoded[0];
        const msgpackBytes = decoded.slice(1, decoded.length - 1);
        const receivedChecksum = decoded[decoded.length - 1];

        // Verify CRC8 checksum
        const computedChecksum = crc8(msgpackBytes);
        if (computedChecksum !== receivedChecksum) {
            console.warn(`Checksum mismatch: received ${receivedChecksum}, computed ${computedChecksum}`);
            return;
        }

        // Unpack MessagePack data
        const argsArray = unpack(msgpackBytes);
        console.log(`Decoded message - ID: ${id}, Args:`, argsArray);

        // Here you can emit an event or call a callback with the decoded message
        if (this.decoder_callback) {
            this.decoder_callback(id, argsArray);
        }
    }

}
