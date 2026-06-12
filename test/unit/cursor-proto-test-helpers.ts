type WireField = { readonly fieldNumber: number; readonly wireType: number; readonly value: bigint | Uint8Array | number };

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function readVarint(data: Uint8Array, startOffset: number): { readonly value: bigint; readonly offset: number } {
	let result = 0n;
	let shift = 0n;
	let offset = startOffset;
	while (offset < data.length) {
		const byte = data[offset++] ?? 0;
		result |= BigInt(byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return { value: result, offset };
		shift += 7n;
		if (shift > 63n) throw new Error("varint too long");
	}
	throw new Error("truncated varint");
}

function encodeVarint(value: bigint): Uint8Array {
	const bytes: number[] = [];
	let current = value;
	do {
		let byte = Number(current & 0x7fn);
		current >>= 7n;
		if (current !== 0n) byte |= 0x80;
		bytes.push(byte);
	} while (current !== 0n);
	return new Uint8Array(bytes);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function encodeLengthDelimitedField(fieldNumber: number, value: Uint8Array): Uint8Array {
	return concatBytes(encodeVarint(BigInt((fieldNumber << 3) | WIRE_LENGTH_DELIMITED)), encodeVarint(BigInt(value.length)), value);
}

function encodeStringField(fieldNumber: number, value: string): Uint8Array {
	return encodeLengthDelimitedField(fieldNumber, textEncoder.encode(value));
}

function encodeMessageField(fieldNumber: number, value: Uint8Array): Uint8Array {
	return encodeLengthDelimitedField(fieldNumber, value);
}

function encodeVarintField(fieldNumber: number, value: bigint): Uint8Array {
	return concatBytes(encodeVarint(BigInt((fieldNumber << 3) | WIRE_VARINT)), encodeVarint(value));
}

function encodeDoubleField(fieldNumber: number, value: number): Uint8Array {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setFloat64(0, value, true);
	return concatBytes(encodeVarint(BigInt((fieldNumber << 3) | WIRE_FIXED64)), bytes);
}

function readFields(data: Uint8Array): readonly WireField[] {
	const fields: WireField[] = [];
	let offset = 0;
	while (offset < data.length) {
		const tag = readVarint(data, offset);
		offset = tag.offset;
		const fieldNumber = Number(tag.value >> 3n);
		const wireType = Number(tag.value & 0x7n);
		if (fieldNumber <= 0) throw new Error("invalid field number");
		if (wireType === WIRE_VARINT) {
			const value = readVarint(data, offset);
			offset = value.offset;
			fields.push({ fieldNumber, wireType, value: value.value });
		} else if (wireType === WIRE_FIXED64) {
			const end = offset + 8;
			if (end > data.length) throw new Error("truncated fixed64 field");
			const view = new DataView(data.buffer, data.byteOffset + offset, 8);
			fields.push({ fieldNumber, wireType, value: view.getFloat64(0, true) });
			offset = end;
		} else if (wireType === WIRE_LENGTH_DELIMITED) {
			const length = readVarint(data, offset);
			offset = length.offset;
			const end = offset + Number(length.value);
			if (end > data.length) throw new Error("truncated length-delimited field");
			fields.push({ fieldNumber, wireType, value: data.slice(offset, end) });
			offset = end;
		} else {
			throw new Error(`unsupported wire type ${wireType}`);
		}
	}
	return fields;
}

function decodeString(data: Uint8Array): string {
	return textDecoder.decode(data);
}

export const cursorProtoTest = { encodeStringField, encodeMessageField, encodeVarintField, encodeDoubleField, concatBytes, readFields, decodeString };
