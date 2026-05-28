const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/doctors
// Retrieve list of doctors with safe search filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, specialization } = req.query;

    const where = {};

    if (search && String(search).trim()) {
      where.name = {
        contains: String(search).trim(),
        mode: 'insensitive',
      };
    }

    if (specialization && specialization !== 'All') {
      where.specialization = String(specialization);
    }

    const doctors = await prisma.doctor.findMany({
      where,
      orderBy: {
        name: 'asc',
      },
    });

    res.json(doctors);
  } catch (error) {
    console.error('Failed to fetch doctors:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// GET /api/doctors/stats
// Returns aggregation details about available doctors
router.get('/stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    const [totalDoctors, surgeonsCount, averageFee, highestExperience] =
      await Promise.all([
        prisma.doctor.count(),

        prisma.doctor.count({
          where: { department: 'Surgery' },
        }),

        prisma.doctor.aggregate({
          _avg: {
            consultationFee: true,
          },
        }),

        prisma.doctor.aggregate({
          _max: {
            experience: true,
          },
        }),
      ]);

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      data: {
        total: totalDoctors,
        surgeons: surgeonsCount,
        averageFee: Math.round(averageFee._avg.consultationFee || 0),
        maxExperience: highestExperience._max.experience || 0,
      },
      debugInfo: {
        executionTimeMs: durationMs,
        notes: 'Loaded independent aggregations in parallel using Promise.all.',
      },
    });
  } catch (error) {
    console.error('Failed to fetch doctor stats:', error);
    res.status(500).json({ error: 'Failed to fetch doctor stats' });
  }
});

// GET /api/doctors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    res.json(doctor);
  } catch (error) {
    console.error('Failed to fetch doctor:', error);
    res.status(500).json({ error: 'Failed to fetch doctor' });
  }
});

module.exports = router;