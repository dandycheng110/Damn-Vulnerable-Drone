// Workarounds for gzweb 3.0.2 against Gazebo Harmonic. Imported before gzweb.
//
// 1. RGBFormat
//    gzweb's websocket texture fallback for JPEGs does
//    `scopeTexture.format = isJPEG ? RGBFormat : RGBAFormat` with RGBFormat
//    neither imported nor existing in three r141 (removed in r137), which
//    throws "RGBFormat is not defined". A bare identifier in the module falls
//    back to the global, so define it as RGBA (what three now uses for JPEGs).
//    nginx.conf also serves the model files over HTTP, so this path is
//    normally not taken.
//
// 2. Missing message definitions from the gz-launch 7 websocket server
//    (gz-msgs10).
//
// The server answers the "protos" request with the definitions of every
// message type, but top-level enums and imported well-known types are left
// out. gz.msgs.Image / CameraSensor reference PixelFormatType,
// DataLoadPathOptions references SphericalCoordinatesType, and Parameter /
// ParameterValue reference google.protobuf.Any, so protobufjs' resolve step
// throws ("no such Type or Enum '.gz.msgs.PixelFormatType'") and gzweb never
// gets past connecting.
//
// gzweb calls protobufjs' parse() on the server's text. Wrap parse() so that
// right after that call the missing definitions (copied from
// /usr/share/gz/gz-msgs10/protos and google/protobuf/any.proto) are parsed
// into the same root. Each one is only added if the server did not send it,
// so a fixed server version makes this a no-op.
import protobuf from 'protobufjs';
import { RGBAFormat } from 'three';

if (globalThis.RGBFormat === undefined) {
  globalThis.RGBFormat = RGBAFormat;
}

const EXTRA = [
  ['gz.msgs.PixelFormatType', `
    syntax = "proto3";
    package gz.msgs;
    enum PixelFormatType {
      UNKNOWN_PIXEL_FORMAT = 0; L_INT8 = 1; L_INT16 = 2; RGB_INT8 = 3;
      RGBA_INT8 = 4; BGRA_INT8 = 5; RGB_INT16 = 6; RGB_INT32 = 7;
      BGR_INT8 = 8; BGR_INT16 = 9; BGR_INT32 = 10; R_FLOAT16 = 11;
      RGB_FLOAT16 = 12; R_FLOAT32 = 13; RGB_FLOAT32 = 14; BAYER_RGGB8 = 15;
      BAYER_BGGR8 = 16; BAYER_GBRG8 = 17; BAYER_GRBG8 = 18;
    }`],
  ['gz.msgs.SphericalCoordinatesType', `
    syntax = "proto3";
    package gz.msgs;
    enum SphericalCoordinatesType {
      SPHERICAL = 0; ECEF = 1; GLOBAL = 2; LOCAL = 3; LOCAL2 = 4;
    }`],
  ['google.protobuf.Any', `
    syntax = "proto3";
    package google.protobuf;
    message Any { string type_url = 1; bytes value = 2; }`],
];

const originalParse = protobuf.parse;

protobuf.parse = function parseWithGzFixups(source, root, options) {
  const result = originalParse.call(this, source, root, options);
  if (typeof source === 'string' && /package\s+gz\.msgs\s*;/.test(source)) {
    for (const [name, text] of EXTRA) {
      if (!result.root.lookup(name)) {
        originalParse.call(this, text, result.root, { keepCase: true });
        console.info(`[dvd] added missing proto definition ${name}`);
      }
    }
  }
  return result;
};
