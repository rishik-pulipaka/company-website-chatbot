const express = require('express');
const { answerQuestion } = require('../services/faq.js');

const MAX_MESSAGE_LENGTH = 1000;

function createChatRouter({ config, db, anthropicClient, model }) {
  const router = express.Router();

  router.post('/chat', async (req, res) => {
    try {
      const { sessionId, message } = req.body || {};
      if (!sessionId || !message || typeof message !== 'string') {
        return res.status(400).json({ error: 'sessionId and message are required' });
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
      }

      const conversationId = db.insertConversation(sessionId);
      db.insertMessage({ conversationId, role: 'user', text: message, answeredFromConfig: null });

      const { inScope, answer } = await answerQuestion({ config, message, anthropicClient, model });

      db.insertMessage({ conversationId, role: 'assistant', text: answer, answeredFromConfig: inScope });
      if (!inScope) {
        db.insertMissedQuestion({ conversationId, questionText: message });
      }

      res.json({ answer, inScope });
    } catch (error) {
      console.error('Error in /api/chat route:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again or leave your contact info.' });
    }
  });

  return router;
}

module.exports = { createChatRouter };
