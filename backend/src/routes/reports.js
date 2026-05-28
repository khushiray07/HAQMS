const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get('/doctor-stats', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const start = Date.now();

    // 1. Fetch all doctors
    const doctors = await prisma.doctor.findMany();
    const reportData = [];

    // 2. Loop through every doctor and query databases sequentially!
    for (const doc of doctors) {
      console.log(`[SLOW REPORT] Querying stats sequentially for doctor: ${doc.name}`);

      // Count total appointments
      const totalAppointments = await prisma.appointment.count({
        where: { doctorId: doc.id },
      });

      // Count completed appointments
      const completedAppointments = await prisma.appointment.count({
        where: { doctorId: doc.id, status: 'COMPLETED' },
      });

      // Count cancelled appointments
      const cancelledAppointments = await prisma.appointment.count({
        where: { doctorId: doc.id, status: 'CANCELLED' },
      });

      // Fetch queue tokens count today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const queueTokensCount = await prisma.queueToken.count({
        where: {
          doctorId: doc.id,
          createdAt: { gte: today },
        },
      });

      // Calculate total potential revenue
      const appointmentsList = await prisma.appointment.findMany({
        where: { doctorId: doc.id, status: 'COMPLETED' },
      });
      const revenue = appointmentsList.length * doc.consultationFee;

      // Add artifical wait to simulate load under scaled database
      // "Ensures database connection doesn't drop" - junior dev comment
      await new Promise(r => setTimeout(r, 80));

      reportData.push({
        id: doc.id,
        name: doc.name,
        specialization: doc.specialization,
        department: doc.department,
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        todayQueueSize: queueTokensCount,
        revenue,
      });
    }

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      timeTakenMs: durationMs,
      data: reportData,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

module.exports = router;
