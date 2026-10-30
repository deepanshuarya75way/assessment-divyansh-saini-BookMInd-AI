const express = require('express');
const router = express.Router();
const { handleChat, getRecommendations, getChatHistory, clearChatHistory, submitRecommendationFeedback } = require('../controllers/aiController');
const authMiddleware = require('../middleware/auth');

router.post('/chat', authMiddleware, handleChat);
router.get('/recommendations', authMiddleware, getRecommendations);
router.put('/recommendations/:recommendationId/feedback', authMiddleware, submitRecommendationFeedback)
router.get('/chat', authMiddleware, getChatHistory);
router.delete('/chat/:id', authMiddleware, clearChatHistory);

module.exports = router;
