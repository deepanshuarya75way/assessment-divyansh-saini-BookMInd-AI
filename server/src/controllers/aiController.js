const { BookRepo } = require('../models/Book');
const { NoteRepo } = require('../models/Note');
const { ChatRepo } = require('../models/Chat');
const { UserRepo } = require('../models/User');
const { RecommendationRepo } = require('../models/Recommendation');
const GeminiService = require('../services/geminiService');
const crypto = require('crypto');
const {RecommendationFeedbackRepo} = require('../models/RecommendationFeedback');

const MAX_PROMPT_LENGTH = 4000;

// For recommendation
const getRecommendationId = (rec) =>{
  return crypto
   .createHash('sha256')
   .update(`${rec.title.trim().toLowerCase()}-${rec.author.trim().toLowerCase()}`)
   .digest('hex')
   .substring(0,16);
};

const attachFeedback = async (userId, recommendations) => {
  const feedbackRecords = await RecommendationFeedbackRepo.findByUser(userId);

  const feedbackMap = new Map(
    feedbackRecords.map(item => [item.recommendationId, item.feedback])
  );

  return recommendations.map(rec => {
    const id = getRecommendationId(rec);

    return {
      ...rec,
      id,
      userFeedback:feedbackMap.get(id) || null
    };
  });
};

const handleChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { prompt, bookId, chatId, stream = true } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ message: 'Prompt query is required.' });
    }

    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ message: `Prompt exceeds maximum allowed length of ${MAX_PROMPT_LENGTH} characters.` });
    }

    // Load contextual user data with strict ownership verification
    let bookContext = null;
    let userNotes = [];

    if (bookId) {
      bookContext = await BookRepo.findById(bookId);
      if (!bookContext || String(bookContext.userId) !== String(userId)) {
        return res.status(403).json({ message: 'Access denied: You do not own this book resource.' });
      }
      userNotes = await NoteRepo.findByBook(userId, bookId);
    } else {
      const notesData = await NoteRepo.findByUser(userId, { limit: 12 });
      userNotes = Array.isArray(notesData) ? notesData : (notesData.notes || []);
    }

    // Fetch lightweight library history
    const booksData = await BookRepo.findByUser(userId, { limit: 8 });
    const readingHistory = Array.isArray(booksData) ? booksData : (booksData.books || []);

    // Load or initialize conversation
    let conversation = null;
    if (chatId) {
      const existing = await ChatRepo.findById(chatId);
      if (existing && String(existing.userId) === String(userId)) {
        conversation = existing;
      }
    }

    if (!conversation) {
      const title = bookContext 
        ? `Query on ${bookContext.title.slice(0, 30)}` 
        : (cleanPrompt.slice(0, 32) + '...');
      conversation = await ChatRepo.create({
        userId,
        bookId: bookId || null,
        title,
        messages: []
      });
    }

    const convId = conversation._id || conversation.id;
    const conversationHistory = conversation.messages || [];

    // Check if client requested streaming
    const isStreamRequested = stream !== false;

    if (isStreamRequested) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      try {
        const streamResult = await GeminiService.generateChatStream({
          prompt: cleanPrompt,
          bookContext,
          userNotes,
          readingHistory,
          conversationHistory,
          onChunk: (chunk) => {
            if (!clientDisconnected) {
              res.write(`data: ${JSON.stringify({ chunk, chatId: convId })}\n\n`);
            }
          }
        });

        const fullResponseText = streamResult.text || '';

        // Persist messages atomically after streaming completes
        if (!clientDisconnected) {
          const now = new Date().toISOString();
          await ChatRepo.appendMessages(convId, [
            { role: 'user', content: cleanPrompt, timestamp: now },
            { role: 'assistant', content: fullResponseText, timestamp: now }
          ]);

          res.write(`data: ${JSON.stringify({ 
            done: true, 
            chatId: convId, 
            fullText: fullResponseText, 
            isFallback: streamResult.isFallback 
          })}\n\n`);
          return res.end();
        }
      } catch (streamErr) {
        console.error('Streaming handler error:', streamErr.message);
        if (!clientDisconnected) {
          res.write(`data: ${JSON.stringify({ error: 'Streaming interrupted', done: true })}\n\n`);
          return res.end();
        }
      }
      return;
    }

    // Standard Non-streaming response
    const chatResult = await GeminiService.generateChatResponse({
      prompt: cleanPrompt,
      bookContext,
      userNotes,
      readingHistory,
      conversationHistory
    });

    const aiResponseText = chatResult.text || '';
    const now = new Date().toISOString();
    const savedChat = await ChatRepo.appendMessages(convId, [
      { role: 'user', content: cleanPrompt, timestamp: now },
      { role: 'assistant', content: aiResponseText, timestamp: now }
    ]);

    return res.json({
      chatId: convId,
      response: aiResponseText,
      isFallback: chatResult.isFallback,
      messages: savedChat ? savedChat.messages : []
    });
  } catch (error) {
    console.error('AI chat error:', error.message);
    return res.status(500).json({
      message: 'BookMind AI could not process that request right now. Please try again.'
    });
  }
};

const getRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { refresh } = req.query;

    // Check persistent cache first unless explicitly refreshing
    if (!refresh || refresh === 'false') {
      const cached = await RecommendationRepo.findByUser(userId);
      if (cached && cached.recommendations && cached.recommendations.length > 0) {
        const recommendationsWithFeedback = await attachFeedback(
          userId,
          cached.recommendations
        );


        return res.json({
          recommendations: recommendationsWithFeedback,
          cached: true,
          generatedAt: cached.generatedAt
        });
      }
    }

    // Cache miss or refresh requested: generate fresh recommendations
    const [user, booksData, notesData] = await Promise.all([
      UserRepo.findById(userId),
      BookRepo.findByUser(userId, { limit: 12 }),
      NoteRepo.findByUser(userId, { limit: 12 })
    ]);

    const readingHistory = Array.isArray(booksData) ? booksData : (booksData.books || []);
    const userNotes = Array.isArray(notesData) ? notesData : (notesData.notes || []);

    const recResult = await GeminiService.generateRecommendations({
      readingHistory,
      favoriteGenres: (user && user.favoriteGenres) ? user.favoriteGenres : [],
      userNotes
    });

    const recommendations = recResult.recommendations || [];

    // Save to cache with 12-hour TTL
    if (recommendations.length > 0) {
      await RecommendationRepo.saveRecommendations(userId, recommendations, 12);
    }

    const recommendationsWithFeedback = await attachFeedback(
      userId,
      recommendations
    );

    return res.json({
      recommendations: recommendationsWithFeedback,
      cached: false,
      isFallback: recResult.isFallback || false,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('getRecommendations error:', error.message);
    return res.status(500).json({ message: 'Failed to generate recommendations.' });
  }
};

const submitRecommendationFeedback = async (req, res) => {
  try {
    const userId = req.user.id;
    const{recommendationId} = req.params;
    const{feedback} = req.body;

    if(!['useful','not_useful'].includes(feedback)){
      return res.status(400).json({
        message: 'Feedback must be useful or not_useful.'
      });
    }

    const cached = await RecommendationRepo.findByUser(userId);

    if(!cached || !cached.recommendations){
      return res.status(404).json({
        message: 'Recommendation not found.'
      });
    }

    const recommendationExist = cached.recommendations.some(
      rec => getRecommendationId(rec) === recommendationId
    );

    if(!recommendationExist){
      return res.status(404).json({
        message: 'Recommendation not found.'
      });
    }

    const savedFeedback = await RecommendationFeedbackRepo.saveFeedback(
      userId,
      recommendationId,
      feedback
    );

    return res.json({
      message: 'Feedback saved successfully.',
      feedback: savedFeedback.feedback
    });

  }catch(error){
    console.error('Recommendation feedback error:' , error.message);

    return res.status(500).json({
      message: 'Failed to save recommendation feedback.'
    });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookId } = req.query;

    const chats = await ChatRepo.findByUser(userId, bookId || null);
    return res.json({ chats });
  } catch (error) {
    console.error('getChatHistory error:', error.message);
    return res.status(500).json({ message: 'Failed to fetch chat history.' });
  }
};

const clearChatHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = req.params.id;

    if (!chatId) {
      return res.status(400).json({ message: 'Chat ID is required.' });
    }

    const chat = await ChatRepo.findById(chatId);
    if (!chat || String(chat.userId) !== String(userId)) {
      return res.status(404).json({ message: 'Chat conversation not found in your account.' });
    }

    await ChatRepo.deleteById(chatId);
    return res.json({ message: 'Conversation cleared successfully.' });
  } catch (error) {
    console.error('clearChatHistory error:', error.message);
    return res.status(500).json({ message: 'Failed to clear chat.' });
  }
};

module.exports = {
  handleChat,
  getRecommendations,
  getChatHistory,
  clearChatHistory,
  submitRecommendationFeedback
};
