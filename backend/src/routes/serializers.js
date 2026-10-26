const { decrypt } = require('../utils/crypto');

const serializeUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: decrypt(u.phone_enc),
  role: u.role,
  lastActiveAt: u.last_active_at,
  inactivityEnabled: u.inactivity_enabled,
  inactivityDays: u.inactivity_days,
  checkinGraceHours: u.checkin_grace_hours,
  dispatchDelayHours: u.dispatch_delay_hours,
  requireAdminConfirmation: u.require_admin_confirmation,
  requireTrusteeConfirmation: u.require_trustee_confirmation,
  createdAt: u.created_at,
});

const serializeContact = (c) => ({
  id: c.id,
  name: decrypt(c.name_enc),
  phone: decrypt(c.phone_enc),
  relationship: c.relationship,
  priority: c.priority,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

const serializeItem = (i) => ({
  id: i.id,
  title: i.title,
  category: i.category,
  status: i.status,
  priority: i.priority,
  dueDate: i.due_date,
  notes: i.notes,
  completedAt: i.completed_at,
  createdAt: i.created_at,
  updatedAt: i.updated_at,
});

const serializeActivation = (a) => ({
  id: a.id,
  userId: a.user_id,
  source: a.source,
  status: a.status,
  checkInDeadline: a.check_in_deadline,
  dispatchAt: a.dispatch_at,
  reportedBy: a.reported_by,
  confirmedBy: a.confirmed_by,
  cancelledBy: a.cancelled_by,
  cancelReason: a.cancel_reason,
  completedAt: a.completed_at,
  createdAt: a.created_at,
  ...(a.user_name ? { userName: a.user_name, userEmail: a.user_email } : {}),
});

module.exports = { serializeUser, serializeContact, serializeItem, serializeActivation };
