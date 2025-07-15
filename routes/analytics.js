const express = require('express');
const { query, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const User = require('../models/User');
const Item = require('../models/Item');

const router = express.Router();

// @route   GET /api/analytics/dashboard
// @desc    Get dashboard analytics
// @access  Private
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get overview statistics
    const overviewStats = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          activeItems: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          soldItems: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
          draftItems: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          totalValue: { $sum: '$price.amount' },
          totalViews: { $sum: '$analytics.totalViews' },
          totalInquiries: { $sum: '$analytics.totalInquiries' },
          avgPrice: { $avg: '$price.amount' },
          avgViews: { $avg: '$analytics.totalViews' },
          avgPerformanceScore: { $avg: '$analytics.performanceScore' }
        }
      }
    ]);

    // Get platform statistics
    const platformStats = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          ebayTotal: { $sum: { $cond: ['$platforms.ebay.enabled', 1, 0] } },
          ebayActive: { $sum: { $cond: [{ $eq: ['$platforms.ebay.status', 'active'] }, 1, 0] } },
          ebayViews: { $sum: '$platforms.ebay.views' },
          ebayWatchers: { $sum: '$platforms.ebay.watchers' },
          willhabenTotal: { $sum: { $cond: ['$platforms.willhaben.enabled', 1, 0] } },
          willhabenActive: { $sum: { $cond: [{ $eq: ['$platforms.willhaben.status', 'active'] }, 1, 0] } },
          willhabenViews: { $sum: '$platforms.willhaben.views' },
          willhabenInquiries: { $sum: '$platforms.willhaben.inquiries' }
        }
      }
    ]);

    // Get sales data
    const salesData = await Item.aggregate([
      { $match: { userId, isActive: true, status: 'sold' } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$soldTo.salePrice' },
          totalFees: { $sum: '$soldTo.fees' },
          netProfit: { $sum: '$soldTo.netProfit' },
          avgSalePrice: { $avg: '$soldTo.salePrice' },
          ebayRevenue: { $sum: { $cond: [{ $eq: ['$soldTo.platform', 'ebay'] }, '$soldTo.salePrice', 0] } },
          willhabenRevenue: { $sum: { $cond: [{ $eq: ['$soldTo.platform', 'willhaben'] }, '$soldTo.salePrice', 0] } }
        }
      }
    ]);

    // Get time-based analytics
    const timeAnalytics = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          itemsCreated: { $sum: 1 },
          totalValue: { $sum: '$price.amount' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } },
      { $limit: 30 }
    ]);

    // Get category breakdown
    const categoryBreakdown = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: '$category.main',
          count: { $sum: 1 },
          totalValue: { $sum: '$price.amount' },
          avgPrice: { $avg: '$price.amount' },
          soldCount: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get recent activities
    const recentActivities = await Item.find({
      userId,
      isActive: true,
      $or: [
        { 'platforms.ebay.lastSync': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        { 'platforms.willhaben.lastSync': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        { updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('title status platforms.ebay.status platforms.willhaben.status updatedAt');

    res.json({
      overview: overviewStats[0] || {},
      platforms: platformStats[0] || {},
      sales: salesData[0] || {},
      timeAnalytics,
      categoryBreakdown,
      recentActivities
    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching dashboard analytics'
    });
  }
});

// @route   GET /api/analytics/performance
// @desc    Get performance analytics
// @access  Private
router.get('/performance', [
  query('period')
    .optional()
    .isIn(['7d', '30d', '90d', '1y', 'all'])
    .withMessage('Invalid period'),
  query('platform')
    .optional()
    .isIn(['ebay', 'willhaben', 'all'])
    .withMessage('Invalid platform'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { period = '30d', platform = 'all' } = req.query;
    const userId = req.user._id;

    // Calculate date range
    let dateFilter = {};
    if (period !== 'all') {
      const days = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
        '1y': 365
      };
      const startDate = new Date(Date.now() - days[period] * 24 * 60 * 60 * 1000);
      dateFilter = { createdAt: { $gte: startDate } };
    }

    // Build match criteria
    const matchCriteria = {
      userId,
      isActive: true,
      ...dateFilter
    };

    // Get performance metrics
    const performanceData = await Item.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalViews: { $sum: '$analytics.totalViews' },
          totalInquiries: { $sum: '$analytics.totalInquiries' },
          avgViewsPerItem: { $avg: '$analytics.totalViews' },
          avgInquiriesPerItem: { $avg: '$analytics.totalInquiries' },
          avgPerformanceScore: { $avg: '$analytics.performanceScore' },
          conversionRate: { $avg: '$analytics.conversionRate' },
          topPerformers: {
            $push: {
              $cond: [
                { $gte: ['$analytics.performanceScore', 70] },
                {
                  id: '$_id',
                  title: '$title',
                  views: '$analytics.totalViews',
                  inquiries: '$analytics.totalInquiries',
                  score: '$analytics.performanceScore'
                },
                null
              ]
            }
          }
        }
      }
    ]);

    // Get platform-specific performance
    let platformPerformance = {};
    if (platform === 'ebay' || platform === 'all') {
      platformPerformance.ebay = await Item.aggregate([
        { $match: { ...matchCriteria, 'platforms.ebay.enabled': true } },
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            activeItems: { $sum: { $cond: [{ $eq: ['$platforms.ebay.status', 'active'] }, 1, 0] } },
            totalViews: { $sum: '$platforms.ebay.views' },
            totalWatchers: { $sum: '$platforms.ebay.watchers' },
            totalQuestions: { $sum: '$platforms.ebay.questions' },
            avgViewsPerItem: { $avg: '$platforms.ebay.views' },
            avgWatchersPerItem: { $avg: '$platforms.ebay.watchers' }
          }
        }
      ]);
    }

    if (platform === 'willhaben' || platform === 'all') {
      platformPerformance.willhaben = await Item.aggregate([
        { $match: { ...matchCriteria, 'platforms.willhaben.enabled': true } },
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            activeItems: { $sum: { $cond: [{ $eq: ['$platforms.willhaben.status', 'active'] }, 1, 0] } },
            totalViews: { $sum: '$platforms.willhaben.views' },
            totalInquiries: { $sum: '$platforms.willhaben.inquiries' },
            avgViewsPerItem: { $avg: '$platforms.willhaben.views' },
            avgInquiriesPerItem: { $avg: '$platforms.willhaben.inquiries' }
          }
        }
      ]);
    }

    // Get trending items
    const trendingItems = await Item.find(matchCriteria)
      .sort({ 'analytics.totalViews': -1 })
      .limit(10)
      .select('title analytics.totalViews analytics.totalInquiries analytics.performanceScore platforms.ebay.views platforms.willhaben.views');

    res.json({
      performance: performanceData[0] || {},
      platforms: {
        ebay: platformPerformance.ebay?.[0] || {},
        willhaben: platformPerformance.willhaben?.[0] || {}
      },
      trending: trendingItems,
      period,
      platform
    });

  } catch (error) {
    console.error('Performance analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching performance analytics'
    });
  }
});

// @route   GET /api/analytics/sales
// @desc    Get sales analytics
// @access  Private
router.get('/sales', [
  query('period')
    .optional()
    .isIn(['7d', '30d', '90d', '1y', 'all'])
    .withMessage('Invalid period'),
  query('platform')
    .optional()
    .isIn(['ebay', 'willhaben', 'all'])
    .withMessage('Invalid platform'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { period = '30d', platform = 'all' } = req.query;
    const userId = req.user._id;

    // Calculate date range
    let dateFilter = {};
    if (period !== 'all') {
      const days = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
        '1y': 365
      };
      const startDate = new Date(Date.now() - days[period] * 24 * 60 * 60 * 1000);
      dateFilter = { 'soldTo.saleDate': { $gte: startDate } };
    }

    // Build match criteria
    const matchCriteria = {
      userId,
      isActive: true,
      status: 'sold',
      ...dateFilter
    };

    if (platform !== 'all') {
      matchCriteria['soldTo.platform'] = platform;
    }

    // Get sales overview
    const salesOverview = await Item.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$soldTo.salePrice' },
          totalFees: { $sum: '$soldTo.fees' },
          netProfit: { $sum: '$soldTo.netProfit' },
          avgSalePrice: { $avg: '$soldTo.salePrice' },
          avgDaysToSell: { $avg: { $divide: [{ $subtract: ['$soldTo.saleDate', '$createdAt'] }, 86400000] } },
          minSalePrice: { $min: '$soldTo.salePrice' },
          maxSalePrice: { $max: '$soldTo.salePrice' }
        }
      }
    ]);

    // Get sales by platform
    const salesByPlatform = await Item.aggregate([
      { $match: { userId, isActive: true, status: 'sold', ...dateFilter } },
      {
        $group: {
          _id: '$soldTo.platform',
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$soldTo.salePrice' },
          netProfit: { $sum: '$soldTo.netProfit' },
          avgSalePrice: { $avg: '$soldTo.salePrice' }
        }
      }
    ]);

    // Get sales by category
    const salesByCategory = await Item.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: '$category.main',
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$soldTo.salePrice' },
          avgSalePrice: { $avg: '$soldTo.salePrice' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // Get daily sales trend
    const dailySales = await Item.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: {
            year: { $year: '$soldTo.saleDate' },
            month: { $month: '$soldTo.saleDate' },
            day: { $dayOfMonth: '$soldTo.saleDate' }
          },
          sales: { $sum: 1 },
          revenue: { $sum: '$soldTo.salePrice' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get conversion funnel
    const conversionFunnel = await Item.aggregate([
      { $match: { userId, isActive: true, ...dateFilter } },
      {
        $group: {
          _id: null,
          totalCreated: { $sum: 1 },
          totalPublished: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          totalViewed: { $sum: { $cond: [{ $gt: ['$analytics.totalViews', 0] }, 1, 0] } },
          totalInquired: { $sum: { $cond: [{ $gt: ['$analytics.totalInquiries', 0] }, 1, 0] } },
          totalSold: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } }
        }
      }
    ]);

    // Get top selling items
    const topSellingItems = await Item.find({
      userId,
      isActive: true,
      status: 'sold',
      ...dateFilter
    })
      .sort({ 'soldTo.salePrice': -1 })
      .limit(10)
      .select('title soldTo.salePrice soldTo.saleDate soldTo.platform category.main');

    res.json({
      overview: salesOverview[0] || {},
      byPlatform: salesByPlatform,
      byCategory: salesByCategory,
      dailyTrend: dailySales,
      conversionFunnel: conversionFunnel[0] || {},
      topSelling: topSellingItems,
      period,
      platform
    });

  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching sales analytics'
    });
  }
});

// @route   GET /api/analytics/inventory
// @desc    Get inventory analytics
// @access  Private
router.get('/inventory', async (req, res) => {
  try {
    const userId = req.user._id;

    // Get inventory overview
    const inventoryOverview = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalValue: { $sum: '$price.amount' },
          avgPrice: { $avg: '$price.amount' },
          draftItems: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          activeItems: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          soldItems: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
          expiredItems: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
        }
      }
    ]);

    // Get inventory by condition
    const inventoryByCondition = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: '$condition',
          count: { $sum: 1 },
          totalValue: { $sum: '$price.amount' },
          avgPrice: { $avg: '$price.amount' }
        }
      }
    ]);

    // Get inventory by category
    const inventoryByCategory = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: '$category.main',
          count: { $sum: 1 },
          totalValue: { $sum: '$price.amount' },
          avgPrice: { $avg: '$price.amount' },
          activeCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          soldCount: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } }
        }
      },
      { $sort: { totalValue: -1 } }
    ]);

    // Get price distribution
    const priceDistribution = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $bucket: {
          groupBy: '$price.amount',
          boundaries: [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
          default: 'Other',
          output: {
            count: { $sum: 1 },
            totalValue: { $sum: '$price.amount' }
          }
        }
      }
    ]);

    // Get aging analysis
    const agingAnalysis = await Item.aggregate([
      { $match: { userId, isActive: true, status: { $in: ['draft', 'active'] } } },
      {
        $addFields: {
          ageInDays: {
            $divide: [
              { $subtract: [new Date(), '$createdAt'] },
              86400000
            ]
          }
        }
      },
      {
        $bucket: {
          groupBy: '$ageInDays',
          boundaries: [0, 7, 14, 30, 60, 90, 180, 365],
          default: 'Over 1 year',
          output: {
            count: { $sum: 1 },
            totalValue: { $sum: '$price.amount' }
          }
        }
      }
    ]);

    // Get low-performing items
    const lowPerformingItems = await Item.find({
      userId,
      isActive: true,
      status: 'active',
      'analytics.performanceScore': { $lt: 30 }
    })
      .sort({ 'analytics.performanceScore': 1 })
      .limit(10)
      .select('title analytics.performanceScore analytics.totalViews analytics.totalInquiries createdAt');

    res.json({
      overview: inventoryOverview[0] || {},
      byCondition: inventoryByCondition,
      byCategory: inventoryByCategory,
      priceDistribution,
      agingAnalysis,
      lowPerforming: lowPerformingItems
    });

  } catch (error) {
    console.error('Inventory analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching inventory analytics'
    });
  }
});

// @route   GET /api/analytics/trends
// @desc    Get trend analytics
// @access  Private
router.get('/trends', [
  query('period')
    .optional()
    .isIn(['7d', '30d', '90d', '1y'])
    .withMessage('Invalid period'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { period = '30d' } = req.query;
    const userId = req.user._id;

    // Calculate date range
    const days = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };
    const startDate = new Date(Date.now() - days[period] * 24 * 60 * 60 * 1000);

    // Get listing trends
    const listingTrends = await Item.aggregate([
      { $match: { userId, isActive: true, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          listingsCreated: { $sum: 1 },
          totalValue: { $sum: '$price.amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get view trends
    const viewTrends = await Item.aggregate([
      { $match: { userId, isActive: true, updatedAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$updatedAt' },
            month: { $month: '$updatedAt' },
            day: { $dayOfMonth: '$updatedAt' }
          },
          totalViews: { $sum: '$analytics.totalViews' },
          totalInquiries: { $sum: '$analytics.totalInquiries' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get category trends
    const categoryTrends = await Item.aggregate([
      { $match: { userId, isActive: true, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            category: '$category.main',
            period: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              week: { $week: '$createdAt' }
            }
          },
          count: { $sum: 1 },
          totalValue: { $sum: '$price.amount' }
        }
      },
      { $sort: { '_id.period.year': 1, '_id.period.month': 1, '_id.period.week': 1 } }
    ]);

    // Get platform trends
    const platformTrends = await Item.aggregate([
      { $match: { userId, isActive: true, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          ebayListings: { $sum: { $cond: ['$platforms.ebay.enabled', 1, 0] } },
          willhabenListings: { $sum: { $cond: ['$platforms.willhaben.enabled', 1, 0] } },
          bothPlatforms: { $sum: { $cond: [{ $and: ['$platforms.ebay.enabled', '$platforms.willhaben.enabled'] }, 1, 0] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Get price trends
    const priceTrends = await Item.aggregate([
      { $match: { userId, isActive: true } },
      {
        $unwind: '$analytics.priceHistory'
      },
      {
        $match: {
          'analytics.priceHistory.date': { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$analytics.priceHistory.date' },
            month: { $month: '$analytics.priceHistory.date' },
            day: { $dayOfMonth: '$analytics.priceHistory.date' }
          },
          avgPrice: { $avg: '$analytics.priceHistory.price' },
          priceChanges: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      listingTrends,
      viewTrends,
      categoryTrends,
      platformTrends,
      priceTrends,
      period
    });

  } catch (error) {
    console.error('Trends analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching trends analytics'
    });
  }
});

// @route   GET /api/analytics/export
// @desc    Export analytics data
// @access  Private
router.get('/export', [
  query('type')
    .isIn(['dashboard', 'sales', 'inventory', 'performance'])
    .withMessage('Invalid export type'),
  query('format')
    .optional()
    .isIn(['json', 'csv'])
    .withMessage('Invalid format'),
  query('period')
    .optional()
    .isIn(['7d', '30d', '90d', '1y', 'all'])
    .withMessage('Invalid period'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { type, format = 'json', period = '30d' } = req.query;
    const userId = req.user._id;

    // Calculate date range
    let dateFilter = {};
    if (period !== 'all') {
      const days = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
        '1y': 365
      };
      const startDate = new Date(Date.now() - days[period] * 24 * 60 * 60 * 1000);
      dateFilter = { createdAt: { $gte: startDate } };
    }

    let data;
    switch (type) {
      case 'dashboard':
        data = await Item.find({ userId, isActive: true, ...dateFilter })
          .select('title status price.amount analytics.totalViews analytics.totalInquiries platforms.ebay.status platforms.willhaben.status createdAt')
          .sort({ createdAt: -1 });
        break;
      case 'sales':
        data = await Item.find({ userId, isActive: true, status: 'sold', ...dateFilter })
          .select('title soldTo.salePrice soldTo.saleDate soldTo.platform soldTo.netProfit category.main')
          .sort({ 'soldTo.saleDate': -1 });
        break;
      case 'inventory':
        data = await Item.find({ userId, isActive: true, ...dateFilter })
          .select('title status condition price.amount category.main availability.quantity createdAt')
          .sort({ createdAt: -1 });
        break;
      case 'performance':
        data = await Item.find({ userId, isActive: true, ...dateFilter })
          .select('title analytics.totalViews analytics.totalInquiries analytics.performanceScore platforms.ebay.views platforms.willhaben.views')
          .sort({ 'analytics.performanceScore': -1 });
        break;
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'csv') {
      // Convert to CSV format
      const csvData = convertToCSV(data, type);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-analytics-${period}.csv"`);
      res.send(csvData);
    } else {
      res.json({
        type,
        period,
        exportedAt: new Date().toISOString(),
        count: data.length,
        data
      });
    }

  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      error: 'Server error while exporting analytics data'
    });
  }
});

// Helper function to convert data to CSV
function convertToCSV(data, type) {
  if (!data || data.length === 0) return '';

  const headers = getCSVHeaders(type);
  const csvRows = [headers.join(',')];

  data.forEach(item => {
    const row = headers.map(header => {
      const value = getNestedValue(item, header);
      return `"${value || ''}"`;
    });
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

// Helper function to get CSV headers based on type
function getCSVHeaders(type) {
  switch (type) {
    case 'dashboard':
      return ['title', 'status', 'price.amount', 'analytics.totalViews', 'analytics.totalInquiries', 'createdAt'];
    case 'sales':
      return ['title', 'soldTo.salePrice', 'soldTo.saleDate', 'soldTo.platform', 'soldTo.netProfit', 'category.main'];
    case 'inventory':
      return ['title', 'status', 'condition', 'price.amount', 'category.main', 'availability.quantity', 'createdAt'];
    case 'performance':
      return ['title', 'analytics.totalViews', 'analytics.totalInquiries', 'analytics.performanceScore', 'platforms.ebay.views', 'platforms.willhaben.views'];
    default:
      return [];
  }
}

// Helper function to get nested object value
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current && current[key], obj);
}

module.exports = router;