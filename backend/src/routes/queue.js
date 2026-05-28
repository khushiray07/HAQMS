const express = require('express');
const { PrismaClient, Prisma } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/queue
// List all active queue tokens
router.get('/', authenticate, async (req, res) => {
  try {
    const { doctorId, status } = req.query;

    const where = {};
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;

    const tokens = await prisma.queueToken.findMany({
      where,
      include: {
        patient: true,
        doctor: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve queue', details: error.message });
  }
});

// POST /api/queue/checkin
// Generate a new queue token for a patient
// CONCURRENCY/RACE CONDITION BUG: Token increment uses aggregate read followed by create.
// Introduce a deliberate asynchronous delay (setTimeout) to force a wide race window
// where concurrent check-ins assign the exact same token number.
router.post('/checkin', authenticate, authorize(['ADMIN', 'RECEPTIONIST', 'DOCTOR']), async (req, res) => {
  try {
    const { patientId, doctorId, appointmentId } = req.body;

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: 'Patient and Doctor ID are required for check-in.' });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found.' });
    }

    if (req.user.role === 'DOCTOR' && doctor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied for this doctor queue.' });
    }

    if (appointmentId) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { patientId: true, doctorId: true },
      });

      if (!appointment || appointment.patientId !== patientId || appointment.doctorId !== doctorId) {
        return res.status(400).json({ error: 'Appointment does not match the selected patient and doctor.' });
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let newToken;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        newToken = await prisma.$transaction(async (tx) => {
          const maxTokenResult = await tx.queueToken.aggregate({
            where: {
              doctorId,
              createdAt: { gte: today },
            },
            _max: {
              tokenNumber: true,
            },
          });

          const currentMax = maxTokenResult._max.tokenNumber || 0;

          return tx.queueToken.create({
            data: {
              tokenNumber: currentMax + 1,
              patientId,
              doctorId,
              appointmentId: appointmentId || null,
              status: 'WAITING',
            },
            include: {
              patient: true,
              doctor: true,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (error.code !== 'P2034' || attempt === 3) {
          throw error;
        }
      }
    }

    res.status(201).json({
      message: 'Checked in successfully. Token generated.',
      token: newToken,
    });
  } catch (error) {
    console.error('Queue check-in error:', error);
    res.status(500).json({ error: 'Check-in failed', details: error.message });
  }
});

// PATCH /api/queue/:id
// Update token status (WAITING -> CALLING -> COMPLETED / SKIPPED)
router.patch('/:id', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['WAITING', 'CALLING', 'COMPLETED', 'SKIPPED'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }

    const token = await prisma.queueToken.findUnique({
      where: { id: req.params.id },
      include: { doctor: { select: { userId: true } } },
    });

    if (!token) {
      return res.status(404).json({ error: 'Queue token not found' });
    }

    if (req.user.role === 'DOCTOR' && token.doctor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied for this queue token.' });
    }

    const updatedToken = await prisma.queueToken.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        patient: true,
        doctor: true,
      },
    });

    res.json(updatedToken);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update queue token', details: error.message });
  }
});

module.exports = router;
