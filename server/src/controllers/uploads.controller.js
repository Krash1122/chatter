// Image uploads, previously multer writing to server/src/uploads.
//
// That can't work on Vercel: the filesystem is read-only apart from /tmp, and
// /tmp is per-invocation, so a file written during the upload request is gone
// before anyone can fetch it -- and express.static would have had nothing to
// serve anyway.
//
// So the browser uploads directly to Cloudinary and only tells this API the
// resulting URL. Besides being the only option that works, it sidesteps
// Vercel's 4.5MB request body limit (the old multer config allowed 8MB) and
// avoids paying function time to shuttle image bytes around.
//
// This endpoint exists so those uploads still have to come from a logged-in
// user: it signs the upload parameters with the API secret, which never
// reaches the browser. An unsigned upload preset would have let anyone on the
// internet fill the Cloudinary account.
const crypto = require('crypto');

const UPLOAD_FOLDER = process.env.CLOUDINARY_FOLDER || 'chatter';

function signature(req, res) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(503).json({ error: 'Image uploads are not configured on this server' });
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary's rule: sort the parameters you're signing by key, join them as
  // a query string, append the secret, SHA-1 the result. The upload request
  // must then send exactly these parameters and no other signed ones, or the
  // signature won't match.
  const params = { folder: UPLOAD_FOLDER, timestamp };
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const sig = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  res.json({ cloudName, apiKey, timestamp, folder: UPLOAD_FOLDER, signature: sig });
}

module.exports = { signature };
