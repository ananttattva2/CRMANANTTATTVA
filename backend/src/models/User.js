const mongoose = require('mongoose');

const MilestoneAcknowledgementSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  seenAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  contactNumber: { type: String, trim: true, default: '', maxlength: 24 },
  crmUserId: { type: String, unique: true, sparse: true, trim: true },
  source: { type: String, trim: true, default: 'crm' },
  password: { type: String }, // used for seeded admin only
  avatarUrl: { type: String },
  role: { type: String, trim: true, default: 'operation', index: true },
  roles: {
    type: [{ type: String, trim: true }],
    default: undefined,
    validate: {
      validator: (values) => !values || (values.length >= 1 && values.length <= 3 && new Set(values).size === values.length),
      message: 'A user must have between 1 and 3 unique roles'
    }
  },
  team: { type: String, default: 'No team assigned' },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  operationHeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastLogin: { type: Date },
  otp: { type: String },
  otpExpires: { type: Date },
  passwordResetOtp: { type: String },
  passwordResetExpires: { type: Date },
  passwordResetRequestedAt: { type: Date },
  passwordResetAttempts: { type: Number, default: 0, select: false },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  milestoneAcknowledgements: { type: [MilestoneAcknowledgementSchema], default: [] }
}, { timestamps: true });

UserSchema.index({ _id: 1, 'milestoneAcknowledgements.key': 1 });

UserSchema.pre('validate', function syncPrimaryRole(next) {
  const normalizedRoles = [...new Set([this.role, ...(Array.isArray(this.roles) ? this.roles : [])]
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean))].slice(0, 3);
  this.roles = normalizedRoles.length ? normalizedRoles : ['operation'];
  this.role = this.roles[0];
  next();
});

module.exports = mongoose.model('User', UserSchema);
