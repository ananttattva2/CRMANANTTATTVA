const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Lead = require('../models/Lead');
const {
  ClientLoginChallenge: Challenge,
  ClientLoginRate: Rate
} = require('../models/ClientLoginChallenge');
const mailer = require('../utils/mailer');
const {
  contactEmailFilter,
  loadPortalData
} = require('../services/clientPortal');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for client login');
  return process.env.JWT_SECRET;
};
const hashOtp = (email, code) => crypto.createHmac('sha256', secret()).update(`client-otp:${email}:${code}`).digest('hex');
const generic = 'If this email is registered in your company contact details, a login code has been sent. It expires in 10 minutes.';
async function rateLimit(key, limit) {
  const bucket = Math.floor(Date.now() / 3600000);
  const record = await Rate.findOneAndUpdate({
    key: crypto.createHash('sha256').update(`${key}:${bucket}`).digest('hex')
  }, {
    $inc: {
      count: 1
    },
    $setOnInsert: {
      expiresAt: new Date((bucket + 1) * 3600000)
    }
  }, {
    upsert: true,
    new: true
  });
  return record.count <= limit;
}
exports.requestOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({
    error: 'Enter a valid contact email address.'
  });
  try {
    secret();
    if (!(await rateLimit(`send-ip:${req.ip}`, 40)) || !(await rateLimit(`send-email:${email}`, 8))) return res.status(429).json({
      error: 'Too many requests. Please try again later.'
    });
    const lead = await Lead.exists(contactEmailFilter(email));
    if (!lead) return res.json({
      message: generic
    });
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = hashOtp(email, code);
    let challenge;
    try {
      challenge = await Challenge.findOneAndUpdate({
        email,
        $or: [{
          lastSentAt: {
            $lte: new Date(Date.now() - 60000)
          }
        }, {
          lastSentAt: {
            $exists: false
          }
        }]
      }, {
        $set: {
          hash,
          expiresAt: new Date(Date.now() + 600000),
          lastSentAt: new Date(),
          attempts: 0
        }
      }, {
        upsert: true,
        new: true
      });
    } catch (error) {
      if (error.code === 11000) return res.status(429).json({
        error: 'Please wait 60 seconds before requesting another code.'
      });
      throw error;
    }
    try {
      await mailer.sendMail(email, 'Anant Tattva Client Portal Login Code', `<h2>Client Portal</h2><p>Your one-time login code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`);
    } catch (error) {
      await Challenge.deleteOne({
        _id: challenge._id,
        hash
      });
      throw error;
    }
    return res.json({
      message: generic
    });
  } catch (error) {
    console.error('[client-login] OTP delivery unavailable', {
      name: error.name
    });
    return res.status(503).json({
      error: 'Login email could not be sent. Please try again shortly.'
    });
  }
};
exports.verifyOtp = async (req, res) => {
  const email = normalizeEmail(req.body.email),
    code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({
    error: 'Enter your email and six-digit code.'
  });
  try {
    if (!(await rateLimit(`verify-ip:${req.ip}`, 100))) return res.status(429).json({
      error: 'Too many attempts. Please try again later.'
    });
    const attempt = await Challenge.findOneAndUpdate({
      email,
      expiresAt: {
        $gt: new Date()
      },
      attempts: {
        $lt: 5
      }
    }, {
      $inc: {
        attempts: 1
      }
    }, {
      new: true
    });
    if (!attempt) return res.status(401).json({
      error: 'Invalid or expired code. Request a new code.'
    });
    const consumed = await Challenge.findOneAndDelete({
      _id: attempt._id,
      hash: hashOtp(email, code),
      expiresAt: {
        $gt: new Date()
      },
      attempts: {
        $lte: 5
      }
    });
    if (!consumed || !(await Lead.exists(contactEmailFilter(email)))) return res.status(401).json({
      error: 'Invalid or expired code. Request a new code.'
    });
    const token = jwt.sign({
      email,
      type: 'client'
    }, secret(), {
      audience: 'client-portal',
      issuer: 'crm-client-portal',
      expiresIn: '2h'
    });
    return res.json({
      token,
      email,
      expiresIn: 7200
    });
  } catch (error) {
    return res.status(503).json({
      error: 'Client login is temporarily unavailable.'
    });
  }
};
exports.requireClient = (req, res, next) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const claims = jwt.verify(token, secret(), {
      audience: 'client-portal',
      issuer: 'crm-client-portal',
      algorithms: ['HS256']
    });
    if (claims.type !== 'client' || !claims.email) throw new Error('Invalid client session');
    req.clientEmail = claims.email;
    res.set('Cache-Control', 'no-store');
    return next();
  } catch {
    return res.status(401).json({
      error: 'Your client session has expired. Please sign in again.'
    });
  }
};
exports.overview = async (req, res) => {
  try {
    const result = await loadPortalData(req.clientEmail);
    if (!result.clients.length) return res.status(403).json({
      error: 'No client records are currently linked to this contact email. Please contact your account manager.'
    });
    return res.json(result);
  } catch (error) {
    console.error('[client-portal] data unavailable', {
      name: error.name
    });
    return res.status(503).json({
      error: 'Your client details could not be loaded. Please retry.'
    });
  }
};
exports._test = {
  hashOtp,
  normalizeEmail,
  rateLimit
};
