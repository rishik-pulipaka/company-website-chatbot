const express = require('express');
const { answerQuestion } = require('../services/faq.js');

function createChatRouter({ config, db, anthropicClient, model }) {
  const router = express.Router();

  router.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message || typeof message !== 'string') {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    const conversationId = db.insertConversation(sessionId);
    db.insertMessage({ conversationId, role: 'user', text: message, answeredFromConfig: null });

    const { inScope, answer } = await answerQuestion({ config, message, anthropicClient, model });

    db.insertMessage({ conversationId, role: 'assistant', text: answer, answeredFromConfig: inScope });
    if (!inScope) {
      db.insertMissedQuestion({ conversationId, questionText: message });
    }

    res.json({ answer, inScope });
  });

  return router;
}

module.exports = { createChatRouter };
