// Mock for file-type (ESM-only library — incompatible with Jest CJS)
// In tests, we assume the file is a valid image by default.
// Tests that specifically test magic byte blocking should mock this differently.
export const fileTypeFromBuffer = async (_buffer: Uint8Array | ArrayBuffer) => {
    return { mime: 'image/jpeg', ext: 'jpg' };
};
