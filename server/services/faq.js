function buildSystemPrompt(config) {
  const lines = [
    `You are a helpful assistant for ${config.businessName}, an HVAC company.`,
    'Answer the visitor question using ONLY the business information below.',
    'Never invent or guess pricing, hours, availability, or services that are not listed here.',
    'If the question cannot be answered from this information, set "inScope" to false.',
    '',
    'Business information:',
    `- Hours: ${config.hours && config.hours.display ? config.hours.display : 'not provided'}`,
    `- Service area: ${config.serviceArea || 'not provided'}`,
    `- Pricing: ${config.pricing || 'not provided'}`,
    `- Services offered: ${config.services && config.services.length ? config.services.join(', ') : 'not provided'}`,
    '',
    'Respond with ONLY a JSON object, no other text, in this exact shape:',
    '{"inScope": true|false, "answer": "your answer as a short, friendly sentence or two"}',
    'If inScope is false, "answer" can be an empty string.'
  ];
  return lines.join('\n');
}

function safeFallback() {
  return {
    inScope: false,
    answer: "I'm not able to answer that from what I know about this business — let me get your contact info so someone can follow up."
  };
}

async function answerQuestion({ config, message, anthropicClient, model }) {
  const system = buildSystemPrompt(config);
  let response;
  try {
    response = await anthropicClient.messages.create({
      model,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: message }]
    });
  } catch (err) {
    console.warn(`[faq] Anthropic API call failed: ${err.message}`);
    return safeFallback();
  }

  try {
    const textBlock = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock.text);
    if (typeof parsed.inScope !== 'boolean' || typeof parsed.answer !== 'string') {
      throw new Error('unexpected response shape');
    }
    return { inScope: parsed.inScope, answer: parsed.answer };
  } catch (err) {
    console.warn(`[faq] could not parse model response: ${err.message}`);
    return safeFallback();
  }
}

module.exports = { answerQuestion, buildSystemPrompt };
