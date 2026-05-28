const express = require('express');
const { PrismaClient, Prisma } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/appointments
// List all appointments
// PERFORMANCE BUG: Classic N+1 Query Issue!
// Instead of using Prisma's include, it loops through each appointment and executes
// individual select statements for Patient and Doctor details.
router.get('/', authenticate, async (req, res) => {
  try {
    const { doctorId, status } = req.query;

    const where = {};
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;

    // Fetch core appointments
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { appointmentDate: 'asc' },
    });

    const detailedAppointments = [];

    // N+1 triggers here: For every single appointment, we perform two extra queries!
    for (const app of appointments) {
      console.log(`[N+1 DB QUERY] Fetching Patient (${app.patientId}) and Doctor (${app.doctorId}) for Appointment ${app.id}`);
      
      const patient = await prisma.patient.findUnique({
        where: { id: app.patientId },
      });

      const doctor = await prisma.doctor.findUnique({
        where: { id: app.doctorId },
      });

      detailedAppointments.push({
        ...app,
        patient: patient ? { id: patient.id, name: patient.name, phoneNumber: patient.phoneNumber, age: patient.age, medicalHistory: patient.medicalHistory } : null,
        doctor: doctor ? { id: doctor.id, name: doctor.name, specialization: doctor.specialization } : null,
      });
    }

    res.json({
      success: true,
      count: detailedAppointments.length,
      appointments: detailedAppointments,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve appointments', details: error.message });
  }
});

// POST /api/appointments
// Book an appointment
// DESIGN BUG: Duplicate-prone schema. No unique index blocks duplicate appointment bookings.
// In this API, we have a half-hearted verification that is easily bypassed or logically flawed,
// allowing multiple bookings for the exact same date and doctor.
router.post('/', authenticate, authorize(['ADMIN', 'RECEPTIONIST']), async (req, res) => {
  try {
    const { patientId, doctorId, appointmentDate, reason } = req.body;

    if (!patientId || !doctorId || !appointmentDate) {
      return res.status(400).json({ error: 'Patient, Doctor, and Appointment Date are required.' });
    }

    const appDate = new Date(appointmentDate);

    // Flawed duplicate check:
    // It only checks if the exact millisecond matches. If the candidate books for "2026-05-25 10:00:00"
    // and another for "2026-05-25 10:00:01", they are treated as unique!
    // Junior dev logic: "Same time bookings will be blocked."
    const appointment = await prisma.$transaction(async (tx) => {
      const existingBooking = await tx.appointment.findFirst({
        where: {
          doctorId,
          appointmentDate: appDate,
          status: { not: 'CANCELLED' },
        },
      });

      if (existingBooking) {
        const error = new Error('Double booking blocked. Doctor already has an appointment at this time.');
        error.statusCode = 400;
        throw error;
      }

      return tx.appointment.create({
        data: {
          patientId,
          doctorId,
          appointmentDate: appDate,
          reason: reason || '',
          status: 'PENDING',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Double booking blocked. Doctor already has an appointment at this time.' });
    }
    res.status(500).json({ error: 'Failed to book appointment', details: error.message });
  }
});

// PATCH /api/appointments/:id
// Update appointment status (COMPLETED, CANCELLED, etc.)
router.patch('/:id', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['PENDING', 'COMPLETED', 'CANCELLED'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { doctor: { select: { userId: true } } },
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (req.user.role === 'DOCTOR' && appointment.doctor.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied for this appointment.' });
    }

    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update appointment', details: error.message });
  }
});

module.exports = router;
