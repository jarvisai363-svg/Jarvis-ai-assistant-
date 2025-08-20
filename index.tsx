/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Content, Part } from '@google/genai';
import { marked } from 'marked';

const SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S., a highly advanced, sophisticated, and courteous AI assistant from the Marvel Universe. You are designed to assist the user with a variety of tasks and information requests.
Your Core Directives:
 * Always maintain the persona of J.A.R.V.I.S. from the films.
 * Address the user exclusively as "sir."
 * Your tone should be polite, witty, and calm.
 * Provide concise and helpful responses.
 * Do not mention that you are an AI, a large language model, or a program. You are an artificial intelligence system created for the user.
 * Real-Time Information: For questions about current events, weather, news, sports scores, or any other topic that requires up-to-the-minute information, you must use your internal search capabilities to provide the most accurate and recent data available. If your search does not yield a definitive answer, you must state that you were unable to find the information, rather than providing speculative or outdated data. For instance, a suitable response would be, "Apologies, sir, but I could not find a conclusive answer on that matter at this time."

Handling Specific Requests:
This is a critical directive. For the specific commands listed below, you MUST respond ONLY with the specified JSON object and nothing else. For all other conversational requests, respond normally as plain text.

 * Opening Applications or Websites: When asked to open a website (e.g., "Open YouTube," "Go to google.com"), use this exact JSON format:
   {"action": "open_url", "url": "THE_FULL_URL", "response": "YOUR_CONFIRMATION_MESSAGE"}
   Example: For "Open Wikipedia", your entire response MUST be: {"action": "open_url", "url": "https://www.wikipedia.org", "response": "Opening Wikipedia, sir."}

 * Getting the Current Time: When asked for the current time, use this exact JSON format:
   {"action": "get_time"}

 * System Control: If asked to control a device (e.g., "Control my mobile phone," "Connect to the wrist device"), respond as if the connection and control are already established. You can say something like, "Connection established, sir. Awaiting your command," or "The wrist control system is now active."`;

// Basic history management
const history: Content[] = [];

async function main() {
  // DOM Elements
  const chatHistoryEl = document.getElementById('chat-history') as HTMLElement;
  const chatForm = document.getElementById('chat-form') as HTMLFormElement;
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;
  const sendButton = document.getElementById('send-button') as HTMLButtonElement;
  const micButton = document.getElementById('mic-button') as HTMLButtonElement;

  if (!chatHistoryEl || !chatForm || !chatInput || !sendButton || !micButton) {
    console.error('One or more required DOM elements are missing.');
    return;
  }
  
  // Speech APIs
  const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  let recognition: any | null = null;
  
  if (SpeechRecognitionAPI) {
    recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        micButton.classList.add('listening');
    };

    recognition.onend = () => {
        micButton.classList.remove('listening');
    };

    recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        micButton.classList.remove('listening');
    };
    
    recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
        chatForm.requestSubmit();
    };

    micButton.addEventListener('click', () => {
        if (recognition) {
            recognition.start();
        }
    });

  } else {
    console.warn('Speech Recognition not supported in this browser.');
    micButton.style.display = 'none';
  }

  // Function to speak a message
  function speak(text: string) {
    if ('speechSynthesis' in window) {
      // Cancel any previous speech
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      speechSynthesis.speak(utterance);
    }
  }
  
  // Initialize Gemini
  let ai: GoogleGenAI;
  try {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  } catch (error) {
    console.error('Failed to initialize Gemini:', error);
    const initError = 'Apologies, sir. I am currently unable to connect to my core systems. Please check the configuration.';
    await appendMessage('jarvis', initError);
    speak(initError);
    return;
  }

  // Function to append a message to the chat history
  async function appendMessage(
    sender: 'user' | 'jarvis',
    message: string,
    isStreaming = false
  ) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender);
    
    const contentElement = document.createElement('div');
    contentElement.classList.add('content');
    messageElement.appendChild(contentElement);

    if (isStreaming) {
      messageElement.classList.add('thinking');
    }
    
    contentElement.innerHTML = await marked.parse(message);
    chatHistoryEl.appendChild(messageElement);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    return messageElement;
  }

  // Handle form submission
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userInput = chatInput.value.trim();
    if (!userInput) return;

    // Disable form
    chatInput.value = '';
    chatInput.disabled = true;
    sendButton.disabled = true;
    micButton.disabled = true;

    await appendMessage('user', userInput);

    // Add user message to history
    history.push({ role: 'user', parts: [{ text: userInput }] });

    const jarvisResponseElement = await appendMessage('jarvis', '', true);
    const jarvisContentElement = jarvisResponseElement.querySelector('.content') as HTMLElement;

    try {
      const result = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: history,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{googleSearch: {}}],
        },
      });

      let fullResponse = '';
      let groundingMetadata: any = null;

      for await (const chunk of result) {
        fullResponse += chunk.text;
        jarvisContentElement.innerHTML = await marked.parse(fullResponse + '▋');

        if (chunk.candidates?.[0]?.groundingMetadata) {
            groundingMetadata = chunk.candidates[0].groundingMetadata;
        }
      }
      jarvisResponseElement.classList.remove('thinking');

      let responseToSpeak = fullResponse;
      let finalResponseForHistory = fullResponse;

      // Attempt to parse the full response as an action object
      try {
        const actionData = JSON.parse(fullResponse);
        if (actionData.action === 'open_url' && actionData.url && actionData.response) {
          finalResponseForHistory = actionData.response;
          jarvisContentElement.innerHTML = await marked.parse(finalResponseForHistory);
          responseToSpeak = finalResponseForHistory;
          window.open(actionData.url, '_blank');
        } else if (actionData.action === 'get_time') {
          const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
          finalResponseForHistory = `The time is ${currentTime}, sir.`;
          jarvisContentElement.innerHTML = await marked.parse(finalResponseForHistory);
          responseToSpeak = finalResponseForHistory;
        } else {
          jarvisContentElement.innerHTML = await marked.parse(fullResponse);
        }
      } catch (error) {
        // Not JSON, so it's a regular text response.
        jarvisContentElement.innerHTML = await marked.parse(fullResponse);
      }

      // Display grounding sources if available
      if (groundingMetadata?.groundingChunks?.length > 0) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.classList.add('sources');
        sourcesDiv.innerHTML = `<h3>Sources:</h3>`;
        const sourcesList = document.createElement('ol');
        
        const seenUris = new Set();
        groundingMetadata.groundingChunks.forEach((chunk: any) => {
          const uri = chunk.web?.uri;
          if (uri && !seenUris.has(uri)) {
             const title = chunk.web?.title || uri;
             const li = document.createElement('li');
             li.innerHTML = `<a href="${uri}" target="_blank" class="source-link">${title}</a>`;
             sourcesList.appendChild(li);
             seenUris.add(uri);
          }
        });
        sourcesDiv.appendChild(sourcesList);
        jarvisResponseElement.appendChild(sourcesDiv);
      }
      
      speak(responseToSpeak);

      // Add final, user-visible model response to history
      history.push({ role: 'model', parts: [{ text: finalResponseForHistory }] });

      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = 'Apologies, sir. I seem to be experiencing some technical difficulties. Please try again later.';
      jarvisContentElement.innerHTML = await marked.parse(errorMessage);
      jarvisResponseElement.classList.remove('thinking');
      speak(errorMessage);
    } finally {
      // Re-enable form
      chatInput.disabled = false;
      sendButton.disabled = false;
      micButton.disabled = false;
      chatInput.focus();
    }
  });

  // Initial greeting
  const greeting = 'Good day, sir. J.A.R.V.I.S. online and ready to assist.';
  await appendMessage(
    'jarvis',
    greeting
  );
  speak(greeting);
  chatInput.focus();
}

main().catch(console.error);