const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');

const User = require('../models/User');
const Item = require('../models/Item');

const router = express.Router();

// eBay API configuration
const EBAY_CONFIG = {
  sandbox: {
    baseURL: 'https://api.sandbox.ebay.com',
    authURL: 'https://auth.sandbox.ebay.com',
    webURL: 'https://www.sandbox.ebay.com'
  },
  production: {
    baseURL: 'https://api.ebay.com',
    authURL: 'https://auth.ebay.com',
    webURL: 'https://www.ebay.com'
  }
};

// Get eBay API configuration based on user settings
const getEbayConfig = (user) => {
  return user.platformSettings.ebay.sandbox ? EBAY_CONFIG.sandbox : EBAY_CONFIG.production;
};

// Create eBay API client
const createEbayClient = async (user) => {
  const config = getEbayConfig(user);
  const { clientId, clientSecret, accessToken } = user.platformSettings.ebay;

  if (!clientId || !clientSecret) {
    throw new Error('eBay API credentials not configured');
  }

  // Check if access token is valid
  if (!user.isEbayTokenValid()) {
    throw new Error('eBay access token expired. Please re-authenticate.');
  }

  return axios.create({
    baseURL: config.baseURL,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
};

// Generate eBay OAuth URL
const generateEbayOAuthURL = (user, state) => {
  const config = getEbayConfig(user);
  const { clientId } = user.platformSettings.ebay;
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/auth/ebay/callback',
    response_type: 'code',
    scope: 'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
    state: state
  });

  return `${config.authURL}/oauth2/authorize?${params.toString()}`;
};

// Exchange authorization code for access token
const exchangeCodeForToken = async (user, code) => {
  const config = getEbayConfig(user);
  const { clientId, clientSecret } = user.platformSettings.ebay;
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  try {
    const response = await axios.post(`${config.authURL}/identity/v1/oauth2/token`, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/auth/ebay/callback'
    }), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data;
  } catch (error) {
    console.error('eBay token exchange error:', error.response?.data || error.message);
    throw new Error('Failed to exchange authorization code for access token');
  }
};

// Refresh eBay access token
const refreshEbayToken = async (user) => {
  const config = getEbayConfig(user);
  const { clientId, clientSecret, refreshToken } = user.platformSettings.ebay;
  
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  try {
    const response = await axios.post(`${config.authURL}/identity/v1/oauth2/token`, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'
    }), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // Update user's tokens
    user.platformSettings.ebay.accessToken = response.data.access_token;
    user.platformSettings.ebay.refreshToken = response.data.refresh_token;
    user.platformSettings.ebay.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
    await user.save();

    return response.data;
  } catch (error) {
    console.error('eBay token refresh error:', error.response?.data || error.message);
    throw new Error('Failed to refresh eBay access token');
  }
};

// @route   POST /api/ebay/configure
// @desc    Configure eBay API settings
// @access  Private
router.post('/configure', [
  body('clientId')
    .notEmpty()
    .withMessage('Client ID is required'),
  body('clientSecret')
    .notEmpty()
    .withMessage('Client Secret is required'),
  body('sandbox')
    .optional()
    .isBoolean()
    .withMessage('Sandbox must be a boolean'),
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

    const { clientId, clientSecret, sandbox = true } = req.body;

    // Update user's eBay settings
    req.user.platformSettings.ebay.clientId = clientId;
    req.user.platformSettings.ebay.clientSecret = clientSecret;
    req.user.platformSettings.ebay.sandbox = sandbox;
    req.user.platformSettings.ebay.isEnabled = false; // Will be enabled after successful auth

    await req.user.save();

    // Generate OAuth URL
    const state = crypto.randomBytes(32).toString('hex');
    const authUrl = generateEbayOAuthURL(req.user, state);

    res.json({
      message: 'eBay API configured successfully',
      authUrl,
      state
    });

  } catch (error) {
    console.error('Configure eBay error:', error);
    res.status(500).json({
      error: 'Server error while configuring eBay API'
    });
  }
});

// @route   POST /api/ebay/auth/callback
// @desc    Handle eBay OAuth callback
// @access  Private
router.post('/auth/callback', [
  body('code')
    .notEmpty()
    .withMessage('Authorization code is required'),
  body('state')
    .notEmpty()
    .withMessage('State parameter is required'),
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

    const { code, state } = req.body;

    // Exchange code for tokens
    const tokenData = await exchangeCodeForToken(req.user, code);

    // Update user's tokens
    req.user.platformSettings.ebay.accessToken = tokenData.access_token;
    req.user.platformSettings.ebay.refreshToken = tokenData.refresh_token;
    req.user.platformSettings.ebay.tokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));
    req.user.platformSettings.ebay.isEnabled = true;

    await req.user.save();

    res.json({
      message: 'eBay authentication successful',
      expiresIn: tokenData.expires_in
    });

  } catch (error) {
    console.error('eBay auth callback error:', error);
    res.status(500).json({
      error: 'Server error during eBay authentication'
    });
  }
});

// @route   POST /api/ebay/refresh-token
// @desc    Refresh eBay access token
// @access  Private
router.post('/refresh-token', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const tokenData = await refreshEbayToken(req.user);

    res.json({
      message: 'eBay token refreshed successfully',
      expiresIn: tokenData.expires_in
    });

  } catch (error) {
    console.error('eBay refresh token error:', error);
    res.status(500).json({
      error: 'Server error while refreshing eBay token'
    });
  }
});

// @route   GET /api/ebay/account
// @desc    Get eBay account information
// @access  Private
router.get('/account', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const client = await createEbayClient(req.user);

    // Get account details
    const accountResponse = await client.get('/sell/account/v1/account');
    
    // Get fulfillment policies
    const fulfillmentResponse = await client.get('/sell/account/v1/fulfillment_policy');
    
    // Get payment policies
    const paymentResponse = await client.get('/sell/account/v1/payment_policy');
    
    // Get return policies
    const returnResponse = await client.get('/sell/account/v1/return_policy');

    res.json({
      account: accountResponse.data,
      policies: {
        fulfillment: fulfillmentResponse.data.fulfillmentPolicies || [],
        payment: paymentResponse.data.paymentPolicies || [],
        return: returnResponse.data.returnPolicies || []
      }
    });

  } catch (error) {
    console.error('Get eBay account error:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({
        error: 'eBay authentication expired. Please re-authenticate.'
      });
    }
    
    res.status(500).json({
      error: 'Server error while fetching eBay account information'
    });
  }
});

// @route   GET /api/ebay/categories
// @desc    Get eBay categories
// @access  Private
router.get('/categories', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const client = await createEbayClient(req.user);
    const config = getEbayConfig(req.user);

    // Get categories from eBay's Commerce API
    const response = await axios.get(`${config.baseURL}/commerce/taxonomy/v1/category_tree/0`, {
      headers: {
        'Authorization': `Bearer ${req.user.platformSettings.ebay.accessToken}`
      }
    });

    res.json({
      categories: response.data.rootCategoryNode
    });

  } catch (error) {
    console.error('Get eBay categories error:', error);
    res.status(500).json({
      error: 'Server error while fetching eBay categories'
    });
  }
});

// @route   POST /api/ebay/items/:id/create-inventory
// @desc    Create inventory item on eBay
// @access  Private
router.post('/items/:id/create-inventory', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    const client = await createEbayClient(req.user);
    
    // Generate SKU if not exists
    const sku = item.platforms.ebay.sku || `${req.user.username}-${item._id}`;

    // Prepare inventory item data
    const inventoryData = {
      availability: {
        shipToLocationAvailability: {
          quantity: item.availability.quantity
        }
      },
      condition: mapConditionToEbay(item.condition),
      product: {
        title: item.title,
        description: item.description,
        aspects: buildEbayAspects(item),
        imageUrls: item.images.map(img => img.url),
        upc: item.specifications.upc || undefined,
        ean: item.specifications.ean || undefined,
        brand: item.specifications.brand || undefined,
        mpn: item.specifications.model || undefined
      },
      packageWeightAndSize: item.shipping.dimensions ? {
        dimensions: {
          height: item.shipping.dimensions.height,
          length: item.shipping.dimensions.length,
          width: item.shipping.dimensions.width,
          unit: item.shipping.dimensions.unit.toUpperCase()
        },
        weight: item.shipping.weight ? {
          value: item.shipping.weight,
          unit: 'KILOGRAM'
        } : undefined
      } : undefined
    };

    // Create inventory item
    const response = await client.put(`/sell/inventory/v1/inventory_item/${sku}`, inventoryData);

    // Update item with eBay data
    item.platforms.ebay.sku = sku;
    item.platforms.ebay.enabled = true;
    await item.syncToPlatform('ebay', {
      success: true,
      sku: sku
    });

    res.json({
      message: 'Inventory item created on eBay successfully',
      sku: sku,
      ebayResponse: response.data
    });

  } catch (error) {
    console.error('Create eBay inventory error:', error);
    
    // Update item with error
    const item = await Item.findById(req.params.id);
    if (item) {
      await item.syncToPlatform('ebay', {
        success: false,
        error: error.response?.data?.errors?.[0]?.message || error.message
      });
    }
    
    res.status(500).json({
      error: 'Server error while creating eBay inventory item',
      details: error.response?.data || error.message
    });
  }
});

// @route   POST /api/ebay/items/:id/create-offer
// @desc    Create offer on eBay
// @access  Private
router.post('/items/:id/create-offer', [
  body('categoryId')
    .notEmpty()
    .withMessage('Category ID is required'),
  body('marketplaceId')
    .optional()
    .isIn(['EBAY_US', 'EBAY_GB', 'EBAY_DE', 'EBAY_FR', 'EBAY_IT', 'EBAY_ES', 'EBAY_AT'])
    .withMessage('Invalid marketplace ID'),
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

    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    const { categoryId, marketplaceId = 'EBAY_US' } = req.body;

    const client = await createEbayClient(req.user);
    
    // Ensure inventory item exists
    const sku = item.platforms.ebay.sku || `${req.user.username}-${item._id}`;
    
    // Prepare offer data
    const offerData = {
      sku: sku,
      marketplaceId: marketplaceId,
      categoryId: categoryId,
      format: item.platforms.ebay.listingFormat || 'FIXED_PRICE',
      availableQuantity: item.availability.quantity,
      pricingSummary: {
        price: {
          value: item.price.amount.toString(),
          currency: item.price.currency
        }
      },
      listingDuration: item.platforms.ebay.duration || 'GTC',
      listingPolicies: {
        paymentPolicyId: req.user.platformSettings.ebay.paymentPolicyId,
        fulfillmentPolicyId: req.user.platformSettings.ebay.fulfillmentPolicyId,
        returnPolicyId: req.user.platformSettings.ebay.returnPolicyId
      },
      merchantLocationKey: req.user.platformSettings.ebay.defaultLocation || 'default_location'
    };

    // Create offer
    const response = await client.post('/sell/inventory/v1/offer', offerData);

    // Update item with eBay offer data
    item.platforms.ebay.offerId = response.data.offerId;
    item.platforms.ebay.categoryId = categoryId;
    await item.syncToPlatform('ebay', {
      success: true,
      offerId: response.data.offerId
    });

    res.json({
      message: 'Offer created on eBay successfully',
      offerId: response.data.offerId,
      ebayResponse: response.data
    });

  } catch (error) {
    console.error('Create eBay offer error:', error);
    
    // Update item with error
    const item = await Item.findById(req.params.id);
    if (item) {
      await item.syncToPlatform('ebay', {
        success: false,
        error: error.response?.data?.errors?.[0]?.message || error.message
      });
    }
    
    res.status(500).json({
      error: 'Server error while creating eBay offer',
      details: error.response?.data || error.message
    });
  }
});

// @route   POST /api/ebay/items/:id/publish
// @desc    Publish offer to eBay
// @access  Private
router.post('/items/:id/publish', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    if (!item.platforms.ebay.offerId) {
      return res.status(400).json({
        error: 'No eBay offer found. Please create an offer first.'
      });
    }

    const client = await createEbayClient(req.user);
    
    // Publish offer
    const response = await client.post(`/sell/inventory/v1/offer/${item.platforms.ebay.offerId}/publish`);

    // Update item with listing data
    item.platforms.ebay.listingId = response.data.listingId;
    item.platforms.ebay.status = 'active';
    item.status = 'active';
    await item.syncToPlatform('ebay', {
      success: true,
      listingId: response.data.listingId
    });

    // Update user statistics
    await req.user.updateStats({
      activeListings: req.user.statistics.activeListings + 1
    });

    res.json({
      message: 'Item published to eBay successfully',
      listingId: response.data.listingId,
      ebayResponse: response.data
    });

  } catch (error) {
    console.error('Publish eBay item error:', error);
    
    // Update item with error
    const item = await Item.findById(req.params.id);
    if (item) {
      await item.syncToPlatform('ebay', {
        success: false,
        error: error.response?.data?.errors?.[0]?.message || error.message
      });
    }
    
    res.status(500).json({
      error: 'Server error while publishing to eBay',
      details: error.response?.data || error.message
    });
  }
});

// @route   POST /api/ebay/items/:id/unpublish
// @desc    Unpublish/withdraw offer from eBay
// @access  Private
router.post('/items/:id/unpublish', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    if (!item.platforms.ebay.offerId) {
      return res.status(400).json({
        error: 'No eBay offer found.'
      });
    }

    const client = await createEbayClient(req.user);
    
    // Withdraw offer
    await client.post(`/sell/inventory/v1/offer/${item.platforms.ebay.offerId}/withdraw`);

    // Update item status
    item.platforms.ebay.status = 'inactive';
    item.status = 'draft';
    await item.syncToPlatform('ebay', {
      success: true
    });

    // Update user statistics
    await req.user.updateStats({
      activeListings: Math.max(0, req.user.statistics.activeListings - 1)
    });

    res.json({
      message: 'Item unpublished from eBay successfully'
    });

  } catch (error) {
    console.error('Unpublish eBay item error:', error);
    res.status(500).json({
      error: 'Server error while unpublishing from eBay',
      details: error.response?.data || error.message
    });
  }
});

// @route   GET /api/ebay/items/:id/analytics
// @desc    Get eBay item analytics
// @access  Private
router.get('/items/:id/analytics', async (req, res) => {
  try {
    if (!req.user.platformSettings.ebay.isEnabled) {
      return res.status(400).json({
        error: 'eBay integration not enabled'
      });
    }

    const item = await Item.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    if (!item.platforms.ebay.listingId) {
      return res.status(400).json({
        error: 'No eBay listing found.'
      });
    }

    const client = await createEbayClient(req.user);
    
    // Get listing analytics (this would typically use eBay's Analytics API)
    // For now, we'll return stored analytics data
    const analytics = {
      views: item.platforms.ebay.views,
      watchers: item.platforms.ebay.watchers,
      questions: item.platforms.ebay.questions,
      lastUpdated: item.platforms.ebay.lastSync
    };

    res.json({
      analytics
    });

  } catch (error) {
    console.error('Get eBay analytics error:', error);
    res.status(500).json({
      error: 'Server error while fetching eBay analytics',
      details: error.response?.data || error.message
    });
  }
});

// Helper functions
function mapConditionToEbay(condition) {
  const conditionMap = {
    'new': 'NEW',
    'like_new': 'LIKE_NEW',
    'very_good': 'VERY_GOOD',
    'good': 'GOOD',
    'acceptable': 'ACCEPTABLE',
    'for_parts': 'FOR_PARTS_OR_NOT_WORKING'
  };
  return conditionMap[condition] || 'USED';
}

function buildEbayAspects(item) {
  const aspects = {};
  
  if (item.specifications.brand) {
    aspects.Brand = [item.specifications.brand];
  }
  
  if (item.specifications.model) {
    aspects.Model = [item.specifications.model];
  }
  
  if (item.specifications.color) {
    aspects.Color = [item.specifications.color];
  }
  
  if (item.specifications.size) {
    aspects.Size = [item.specifications.size];
  }
  
  if (item.specifications.material) {
    aspects.Material = [item.specifications.material];
  }
  
  if (item.specifications.year) {
    aspects.Year = [item.specifications.year.toString()];
  }
  
  return aspects;
}

module.exports = router;