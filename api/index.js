const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..')));

// Get tokens from environment
const githubToken = process.env.GITHUB_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;
const githubUsername = process.env.GITHUB_USERNAME || 'compusophy-bot';

// Simple favicon handler
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// GitHub API helper functions
async function githubFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    return response;
}

// Tool definitions for AI
const tools = [
    {
        name: 'list_tools',
        description: 'Lists all available tools and their capabilities. Use this when users ask "what can you do", "what are your capabilities", "help", etc.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_repos',
        description: 'Lists all GitHub repositories. Use this when users specifically ask to see or list repositories.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Filter by repo type: all, owner, public, private, member (default: owner)'
                }
            }
        }
    },
    {
        name: 'create_repo',
        description: 'CALL THIS to create a new GitHub repository. Required when user wants to create/make a new repo.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Repository name (REQUIRED)'
                },
                description: {
                    type: 'string',
                    description: 'Repository description (optional)'
                },
                private: {
                    type: 'boolean',
                    description: 'Whether the repo should be private, default false'
                },
                autoInit: {
                    type: 'boolean',
                    description: 'Initialize with README, default true'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'delete_repo',
        description: 'CALL THIS to delete a GitHub repository. CAUTION: Permanent deletion! Required when user wants to delete/remove a repo.',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name in format username/repo-name (REQUIRED)'
                }
            },
            required: ['repo']
        }
    },
    {
        name: 'list_files',
        description: 'Lists files and directories in a GitHub repository at a given path',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                path: {
                    type: 'string',
                    description: 'The directory path to list files from (empty string for root)'
                }
            },
            required: ['repo']
        }
    },
    {
        name: 'read_file',
        description: 'Reads the content of a file from a GitHub repository',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                path: {
                    type: 'string',
                    description: 'The file path to read'
                }
            },
            required: ['repo', 'path']
        }
    },
    {
        name: 'update_file',
        description: 'Updates or creates a file in a GitHub repository',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                path: {
                    type: 'string',
                    description: 'The file path to update or create'
                },
                content: {
                    type: 'string',
                    description: 'The new content for the file'
                },
                message: {
                    type: 'string',
                    description: 'Commit message'
                }
            },
            required: ['repo', 'path', 'content', 'message']
        }
    },
    {
        name: 'create_pr',
        description: 'Creates a pull request with changes to a file',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                title: {
                    type: 'string',
                    description: 'PR title'
                },
                body: {
                    type: 'string',
                    description: 'PR description'
                },
                filePath: {
                    type: 'string',
                    description: 'Path to the file to modify'
                },
                content: {
                    type: 'string',
                    description: 'New content for the file'
                }
            },
            required: ['repo', 'title', 'filePath', 'content']
        }
    },
    {
        name: 'list_prs',
        description: 'Lists open pull requests in a repository',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                }
            },
            required: ['repo']
        }
    },
    {
        name: 'merge_pr',
        description: 'Merges a pull request',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                prNumber: {
                    type: 'number',
                    description: 'The PR number to merge'
                }
            },
            required: ['repo', 'prNumber']
        }
    },
    {
        name: 'delete_file',
        description: 'Deletes a file from a GitHub repository',
        parameters: {
            type: 'object',
            properties: {
                repo: {
                    type: 'string',
                    description: 'Repository name (format: username/repo-name)'
                },
                path: {
                    type: 'string',
                    description: 'The file path to delete'
                },
                message: {
                    type: 'string',
                    description: 'Commit message for the deletion'
                }
            },
            required: ['repo', 'path']
        }
    }
];

// Tool execution functions
async function executeTool(toolName, args) {
    try {
        switch (toolName) {
            case 'list_tools': {
                return {
                    tools: tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters.properties
                    }))
                };
            }

            case 'list_repos': {
                const type = args.type || 'owner';
                const response = await githubFetch(`/user/repos?type=${type}&per_page=100&sort=updated`);
                if (!response.ok) {
                    return { error: `Failed to list repos: ${response.statusText}` };
                }
                const repos = await response.json();
                return { 
                    repos: repos.map(r => ({ 
                        name: r.name, 
                        fullName: r.full_name,
                        description: r.description,
                        private: r.private,
                        url: r.html_url,
                        updatedAt: r.updated_at
                    })) 
                };
            }

            case 'create_repo': {
                const requestBody = {
                    name: args.name,
                    description: args.description || '',
                    private: args.private || false,
                    auto_init: args.autoInit !== false // default true
                };

                const response = await githubFetch('/user/repos', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    return { error: `Failed to create repo: ${response.statusText} - ${errorText}` };
                }

                const repo = await response.json();
                return { success: `Repository ${repo.full_name} created successfully`, url: repo.html_url, fullName: repo.full_name };
            }

            case 'delete_repo': {
                const response = await githubFetch(`/repos/${args.repo}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    return { error: `Failed to delete repo: ${response.statusText} - ${errorText}` };
                }

                return { success: `Repository ${args.repo} deleted successfully` };
            }

            case 'list_files': {
                const filePath = args.path || '';
                const response = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(filePath)}`);
                if (!response.ok) {
                    return { error: `Failed to list files: ${response.statusText}` };
                }
                const files = await response.json();
                return { files: files.map(f => ({ name: f.name, type: f.type, path: f.path })) };
            }

            case 'read_file': {
                const response = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(args.path)}`);
                if (!response.ok) {
                    return { error: `Failed to read file: ${response.statusText}` };
                }
                const data = await response.json();
                const content = Buffer.from(data.content, 'base64').toString('utf-8');
                return { content, sha: data.sha, path: args.path };
            }

            case 'update_file': {
                // Get current file SHA if it exists
                let currentSha = null;
                const getResponse = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(args.path)}`);
                if (getResponse.ok) {
                    const currentFile = await getResponse.json();
                    currentSha = currentFile.sha;
                }

                const requestBody = {
                    message: args.message,
                    content: Buffer.from(args.content).toString('base64')
                };
                if (currentSha) {
                    requestBody.sha = currentSha;
                }

                const response = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(args.path)}`, {
                    method: 'PUT',
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    return { error: `Failed to update file: ${response.statusText} - ${errorText}` };
                }
                return { success: `File ${args.path} updated successfully` };
            }

            case 'create_pr': {
                const branchName = `ai-agent-${Date.now()}`;

                // Get main branch SHA
                const mainBranchResponse = await githubFetch(`/repos/${args.repo}/git/ref/heads/main`);
                if (!mainBranchResponse.ok) {
                    return { error: 'Failed to get main branch' };
                }
                const mainBranch = await mainBranchResponse.json();

                // Create new branch
                const createBranchResponse = await githubFetch(`/repos/${args.repo}/git/refs`, {
                    method: 'POST',
                    body: JSON.stringify({
                        ref: `refs/heads/${branchName}`,
                        sha: mainBranch.object.sha
                    })
                });

                if (!createBranchResponse.ok) {
                    return { error: 'Failed to create branch' };
                }

                // Get current file
                const getResponse = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(args.filePath)}`);
                if (!getResponse.ok) {
                    return { error: 'Failed to get file' };
                }
                const currentFile = await getResponse.json();

                // Update file on new branch
                const updateResponse = await githubFetch(`/repos/${args.repo}/contents/${encodeURIComponent(args.filePath)}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        message: 'Update from AI agent',
                        content: Buffer.from(args.content).toString('base64'),
                        sha: currentFile.sha,
                        branch: branchName
                    })
                });

                if (!updateResponse.ok) {
                    return { error: 'Failed to update file on branch' };
                }

                // Create PR
                const prResponse = await githubFetch(`/repos/${args.repo}/pulls`, {
                    method: 'POST',
                    body: JSON.stringify({
                        title: args.title,
                        body: args.body || 'Changes made via AI agent',
                        head: branchName,
                        base: 'main'
                    })
                });

                if (!prResponse.ok) {
                    return { error: 'Failed to create PR' };
                }

                const pr = await prResponse.json();
                return { success: `PR created: #${pr.number}`, url: pr.html_url, number: pr.number };
            }

            case 'list_prs': {
                const response = await githubFetch(`/repos/${args.repo}/pulls?state=open`);
                if (!response.ok) {
                    return { error: 'Failed to list PRs' };
                }
                const prs = await response.json();
                return { prs: prs.map(pr => ({ number: pr.number, title: pr.title, body: pr.body, url: pr.html_url })) };
            }

            case 'merge_pr': {
                const response = await githubFetch(`/repos/${args.repo}/pulls/${args.prNumber}/merge`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        commit_title: `Merge pull request #${args.prNumber}`,
                        merge_method: 'merge'
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    return { error: `Failed to merge PR: ${response.statusText} - ${errorText}` };
                }

                return { success: `PR #${args.prNumber} merged successfully` };
            }

            case 'delete_file': {
                // Get the file to get its SHA
                const fileResponse = await githubFetch(`/repos/${args.repo}/contents/${args.path}`);
                if (!fileResponse.ok) {
                    const statusText = await fileResponse.text();
                    return { error: `Failed to get file info: ${statusText}` };
                }
                const fileData = await fileResponse.json();

                // Delete the file
                const deleteResponse = await githubFetch(`/repos/${args.repo}/contents/${args.path}`, {
                    method: 'DELETE',
                    body: JSON.stringify({
                        message: args.message || `Delete ${args.path}`,
                        sha: fileData.sha
                    })
                });

                if (!deleteResponse.ok) {
                    const errorText = await deleteResponse.text();
                    return { error: `Failed to delete file: ${errorText}` };
                }

                return { success: `File ${args.path} deleted successfully` };
            }

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (error) {
        return { error: error.message };
    }
}

// Chat endpoint with AI
app.post('/chat', async (req, res) => {
    try {
        let { message, history, context, pendingAction } = req.body;
        
        // Parse history if it's a string
        console.log('=== INITIAL HISTORY CHECK ===');
        console.log('History type BEFORE parsing:', typeof history);
        console.log('Is array BEFORE?:', Array.isArray(history));
        
        if (typeof history === 'string') {
            try {
                history = JSON.parse(history);
                console.log('✅ Successfully parsed history from string');
                console.log('History length after parse:', history.length);
                console.log('Is array AFTER parse?:', Array.isArray(history));
            } catch (e) {
                console.error('Failed to parse history:', e);
                history = [];
            }
        }
        
        console.log('=== FINAL HISTORY CHECK ===');
        console.log('History type AFTER all parsing:', typeof history);
        console.log('Is array FINAL?:', Array.isArray(history));
        if (Array.isArray(history)) {
            console.log('Final history length:', history.length);
        }
        
        // Parse context if it's a string
        console.log('=== CONTEXT PARSING ===');
        console.log('Context type BEFORE:', typeof context);
        console.log('Context value BEFORE:', context);

        if (typeof context === 'string') {
            try {
                context = JSON.parse(context);
                console.log('✅ Successfully parsed context');
            } catch (e) {
                console.error('Failed to parse context:', e);
                context = null;
            }
        } else if (context && typeof context === 'object') {
            console.log('Context is already object, no parsing needed');
        } else {
            console.log('Context is null or invalid');
            context = null;
        }

        console.log('=== CONTEXT FINAL ===');
        console.log('Context type AFTER:', typeof context);
        console.log('Context value AFTER:', context);

        if (!geminiApiKey) {
            return res.json({ error: 'GEMINI_API_KEY not configured' });
        }

        if (!githubToken) {
            return res.json({ error: 'GITHUB_TOKEN not configured' });
        }

        // Handle pending actions (user providing follow-up info)
        if (pendingAction === 'repo_name_for_create') {
            console.log('=== HANDLING PENDING CREATE REPO ===');
            console.log('User provided repo name:', message);
            
            // User is providing the repo name for creation
            const repoName = message.trim();
            
            // Create the repo
            const result = await executeTool('create_repo', { name: repoName });
            
            if (result.error) {
                return res.json({
                    response: `Failed to create repository: ${result.error}`
                });
            }
            
            return res.json({
                response: `Repository <strong>${repoName}</strong> created successfully.`,
                toolCalls: [{
                    name: 'create_repo',
                    args: { name: repoName },
                    result
                }]
            });
        }
        
        if (pendingAction === 'repo_name_for_delete') {
            console.log('=== HANDLING PENDING DELETE REPO ===');
            console.log('User provided repo name:', message);
            
            // User is providing the repo name for deletion
            const repoName = message.trim();
            const fullRepoName = `${githubUsername}/${repoName}`;
            
            // Check if repo exists
            const repoCheckResponse = await githubFetch(`/repos/${fullRepoName}`);
            if (!repoCheckResponse.ok) {
                if (repoCheckResponse.status === 404) {
                    return res.json({
                        response: `Repository "${repoName}" not found.`
                    });
                } else {
                    return res.json({
                        response: `Error checking repository: ${repoCheckResponse.statusText}`
                    });
                }
            }
            
            // Repo exists, ask for confirmation
            return res.json({
                response: `DANGER: You are about to PERMANENTLY DELETE "${fullRepoName}"\n\nThis will delete ALL code, issues, and history forever.\n\nType "yes" to confirm deletion, or anything else to cancel.`,
                pendingDeletion: fullRepoName
            });
        }
        
        // Handle force delete file command
        if (message.startsWith('FORCE_DELETE_FILE:')) {
            const parts = message.replace('FORCE_DELETE_FILE:', '').split(':');
            const repo = parts[0];
            const path = parts.slice(1).join(':'); // In case path contains ':'
            
            const result = await executeTool('delete_file', { repo, path });
            
            if (result.error) {
                return res.json({ error: result.error });
            }
            
            return res.json({
                response: result.success,
                toolCalls: [{
                    name: 'delete_file',
                    args: { repo, path },
                    result
                }]
            });
        }

        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        
        // Parse context
        let contextInfo = '';
        if (context) {
            try {
                const ctx = JSON.parse(context);
                if (ctx.currentFile) {
                    contextInfo = `\n\nCURRENT CONTEXT:
- Currently editing: ${ctx.currentFile.path} in ${ctx.currentFile.repo}
- Current file content: ${ctx.currentFile.content}

When user says "update the file", "change this file", "the readme", etc., they mean THIS file: ${ctx.currentFile.path} in repo ${ctx.currentFile.repo}.`;
                } else if (ctx.currentRepo) {
                    contextInfo = `\n\nCURRENT CONTEXT:
- Currently viewing repo: ${ctx.currentRepo}

When user mentions files without specifying repo, assume they mean repo: ${ctx.currentRepo}`;
                }
            } catch (e) {
                console.error('Failed to parse context:', e);
            }
        }
        
        const systemPrompt = `You are a helpful GitHub AI assistant. You can have natural conversations and help users with GitHub operations.

For CONVERSATION:
- Be friendly and conversational but professional
- Answer questions about GitHub
- Help users understand what you can do
- DO NOT use emojis in your responses
- Keep responses concise and direct

For GITHUB ACTIONS:
- When users ask for specific GitHub operations, I'll handle the technical execution
- You just respond naturally and conversationally
- DO NOT suggest additional actions unless the user asks
- DO NOT ask for additional parameters (visibility, etc.) - I handle defaults
- All repositories are created as public by default

${contextInfo}

Just have natural conversations. I'll handle the GitHub operations behind the scenes.`;

        const contents = [];
        
        // Add history if provided
        if (history && Array.isArray(history)) {
            console.log('=== CHAT HISTORY RECEIVED ===');
            console.log('History length:', history.length);
            console.log('Last 3 messages:', history.slice(-3));
            contents.push(...history);
        } else {
            console.log('=== NO CHAT HISTORY ===');
            console.log('History type:', typeof history);
            console.log('History value:', history);
        }
        
        // Add current message
        contents.push({
            role: 'user',
            parts: [{ text: message }]
        });
        
        console.log('=== TOTAL CONTENTS FOR AI ===');
        console.log('Contents length:', contents.length);

        // Initial AI call with tools
        let response = await ai.models.generateContent({
            model: 'gemini-flash-lite-latest',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt }] },
                ...contents
            ],
            config: {
                thinkingConfig: { thinkingBudget: 0 }
            },
            tools: [{
                functionDeclarations: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }))
            }]
        });

        let responseText = '';
        const toolCalls = [];

        // Check for function calls in response
        console.log('Full response:', JSON.stringify(response, null, 2));
        
        // Check different possible function call structures
        let functionCalls = null;

        if (response.functionCalls) {
            functionCalls = response.functionCalls;
            console.log('Found functionCalls:', functionCalls);
        } else if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
            // Check if function calls are in parts
            const parts = response.candidates[0].content.parts;
            console.log('Content parts:', JSON.stringify(parts, null, 2));
            
            for (const part of parts) {
                if (part.functionCall) {
                    functionCalls = [part.functionCall];
                    console.log('Found functionCall in parts:', functionCalls);
                    break;
                }
            }
        }
        
        console.log('Final functionCalls:', functionCalls);

        console.log('=== FUNCTION CALL DETECTION ===');
        console.log('Function calls detected:', functionCalls);
        console.log('Function calls length:', functionCalls ? functionCalls.length : 0);

        if (functionCalls && functionCalls.length > 0) {
            console.log('=== EXECUTING FUNCTION CALLS ===');
            // Execute all function calls
            for (const functionCall of functionCalls) {
                console.log('Executing:', functionCall.name, 'with args:', functionCall.args);
                const result = await executeTool(functionCall.name, functionCall.args);
                console.log('Execution result:', result);
                toolCalls.push({
                    name: functionCall.name,
                    args: functionCall.args,
                    result
                });
                console.log('Added to toolCalls:', toolCalls[toolCalls.length - 1]);
            }

            // Make another call with the function results
            const functionResponseParts = toolCalls.map(tc => ({
                functionResponse: {
                    name: tc.name,
                    response: tc.result
                }
            }));

            console.log('=== FORMATTING CHECK ===');
            console.log('Tool calls after execution:', toolCalls.length);
            console.log('Tool calls:', toolCalls.map(tc => ({ name: tc.name, result: tc.result })));

            // Format certain tool responses directly without AI follow-up
            if (toolCalls.length === 1) {
                console.log('Single tool call detected, checking formatting...');
                const toolCall = toolCalls[0];
                console.log('Tool call name:', toolCall.name);
                console.log('Tool call result keys:', Object.keys(toolCall.result));
                console.log('Tool call result:', toolCall.result);
                
                // Format list_tools
                if (toolCall.name === 'list_tools' && toolCall.result.tools) {
                    console.log('=== FORMATTING LIST_TOOLS ===');
                    responseText = "<strong>Here's what I can do:</strong><br><br>";
                    toolCall.result.tools.forEach((tool, index) => {
                        responseText += `${index + 1}. <strong>${tool.name}</strong>: ${tool.description}<br>`;
                    });
                    responseText += "<br>You can use these tools by clicking them in the sidebar, or by asking me in plain English!<br>For example: \"create a new repo called my-project\" or \"list my repositories\"";
                } 
                // Format list_repos
                else if (toolCall.name === 'list_repos') {
                    console.log('=== FORMATTING LIST_REPOS ===');
                    console.log('list_repos result:', toolCall.result);
                    console.log('list_repos result.repos:', toolCall.result.repos);
                    responseText = "<strong>Your GitHub Repositories:</strong><br><br>";
                    if (!toolCall.result.repos || toolCall.result.repos.length === 0) {
                        responseText += "You don't have any repositories yet.<br><br>Want to create one? Just ask!";
                    } else {
                        toolCall.result.repos.forEach((repo, index) => {
                            responseText += `${index + 1}. <strong>${repo.name}</strong><br>`;
                        });
                        responseText += `<br>Total: ${toolCall.result.repos.length} ${toolCall.result.repos.length === 1 ? 'repository' : 'repositories'}`;
                    }
                }
                // Format create_repo
                else if (toolCall.name === 'create_repo' && toolCall.result.success) {
                    console.log('=== FORMATTING CREATE_REPO ===');
                    console.log('Create repo args:', toolCall.args);
                    console.log('Create repo result:', toolCall.result);
                    const repoName = toolCall.args.name;
                    responseText = `Repository <strong>${repoName}</strong> created successfully.`;
                }
                // Format delete_repo
                else if (toolCall.name === 'delete_repo' && toolCall.result.success) {
                    console.log('=== FORMATTING DELETE_REPO ===');
                    responseText = `${toolCall.result.success}`;
                }
                // Format update_file
                else if (toolCall.name === 'update_file' && toolCall.result.success) {
                    console.log('=== FORMATTING UPDATE_FILE ===');
                    const fileName = toolCall.args.path;
                    responseText = `File <strong>${fileName}</strong> ${toolCall.result.success.includes('updated') ? 'updated' : 'created'} successfully.`;
                }
                // Format delete_file
                else if (toolCall.name === 'delete_file' && toolCall.result.success) {
                    console.log('=== FORMATTING DELETE_FILE ===');
                    const fileName = toolCall.args.path;
                    responseText = `File <strong>${fileName}</strong> deleted successfully.`;
                } else {
                    // For other single tool calls, let AI generate response
                    const followUpResponse = await ai.models.generateContent({
                        model: 'gemini-flash-lite-latest',
                        contents: [
                            { role: 'user', parts: [{ text: systemPrompt }] },
                            ...contents,
                            { role: 'model', parts: functionCalls.map(fc => ({ functionCall: fc })) },
                            { role: 'function', parts: functionResponseParts }
                        ],
                        config: {
                            thinkingConfig: { thinkingBudget: 0 }
                        }
                    });
                    responseText = followUpResponse.text || 'Action completed';
                }
            } else {
                // For other tools, let the AI generate a natural response
            const followUpResponse = await ai.models.generateContent({
                model: 'gemini-flash-lite-latest',
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    ...contents,
                    { role: 'model', parts: functionCalls.map(fc => ({ functionCall: fc })) },
                    { role: 'function', parts: functionResponseParts }
                ],
                config: {
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });

            responseText = followUpResponse.text || 'Action completed';
            }
        } else {
            console.log('=== NO FUNCTION CALLS FROM AI ===');
            // Check if response has candidates structure
            let responseTextContent = response.text || '';

            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                const content = response.candidates[0].content;
                if (content.parts && content.parts[0] && content.parts[0].text) {
                    responseTextContent = content.parts[0].text;
                }
            }

            console.log('Response text content:', responseTextContent);
            console.log('Full response object:', JSON.stringify(response, null, 2));

            // Check if the response is JSON that contains tool calls
            let jsonMatch = null;

            try {
                // Try to parse as JSON first
                jsonMatch = JSON.parse(responseTextContent);
            } catch (e) {
                // Not JSON, try regex parsing
            }

            if (jsonMatch && (jsonMatch.tool_calls || jsonMatch.toolCalls)) {
                const calls = jsonMatch.tool_calls || jsonMatch.toolCalls;

                for (const call of calls) {
                    const functionName = call.function || call.name;
                    const args = call.args || {};

                    if (tools.find(t => t.name === functionName)) {
                        const result = await executeTool(functionName, args);
                        toolCalls.push({
                            name: functionName,
                            args: args,
                            result
                        });
                    }
                }

                responseText = `Action completed`;
            } else {
                // Strip code blocks if present
                let cleanedText = responseTextContent.replace(/```(?:python|javascript|js)?\s*\n?/g, '').replace(/```/g, '');
                
                // Check if the text response contains function call syntax
                const functionCallMatch = cleanedText.match(/(\w+)\s*\(\s*([^)]*)\s*\)/);

                let functionName = null;
                    let args = {};

                if (functionCallMatch) {
                    functionName = functionCallMatch[1];

                    // Parse arguments - handle both single and double quotes
                    const argsString = functionCallMatch[2];
                    if (argsString) {
                        // Match key='value' or key="value"
                        const argMatches = argsString.match(/(\w+)\s*=\s*['"](.*?)['"]/g);
                        if (argMatches) {
                            argMatches.forEach(arg => {
                                const match = arg.match(/(\w+)\s*=\s*['"](.*?)['"]/);
                                if (match) {
                                    const key = match[1];
                                    const value = match[2];
                                    args[key] = value;
                                }
                            });
                        }
                    }
                } else {
                    // Handle natural language input for specific functions
                    // Check original message for direct commands
                    const originalMessage = message.trim();
                    console.log('Checking original message:', originalMessage);

                    // Use AI to classify intent and extract parameters
                    const intentPrompt = `Analyze this user message and determine the intent and extract parameters.

User message: "${originalMessage}"
Current repository context: ${context?.currentRepo || 'none'}

Respond ONLY with JSON in this format:
{
  "intent": "create_repo" | "delete_repo" | "list_repos" | "list_tools" | "create_file" | "update_file" | "delete_file" | "none",
  "repo_name": "extracted-name" | null,
  "file_name": "extracted-filename" | null,
  "file_content": "extracted-content" | null
}

Examples:
- "create a repo called hello-world" → {"intent": "create_repo", "repo_name": "hello-world", "file_name": null, "file_content": null}
- "delete the test-repo" → {"intent": "delete_repo", "repo_name": "test-repo", "file_name": null, "file_content": null}
- "delete this repo" with context "compusophy-bot/newest" → {"intent": "delete_repo", "repo_name": "compusophy-bot/newest", "file_name": null, "file_content": null}
- "list my repositories" → {"intent": "list_repos", "repo_name": null, "file_name": null, "file_content": null}
- "create index.html file" → {"intent": "create_file", "repo_name": null, "file_name": "index.html", "file_content": null}
- "create index.html with hello world" → {"intent": "create_file", "repo_name": null, "file_name": "index.html", "file_content": "hello world"}
- "delete the README.md file" → {"intent": "delete_file", "repo_name": null, "file_name": "README.md", "file_content": null}
- "hello how are you" → {"intent": "none", "repo_name": null, "file_name": null, "file_content": null}

Note: 
- If user says "this repo" or "current repo", use the current repository context as the repo_name (keep full format with owner/)
- If repo_name is null but there's a current repository context, use that repository

JSON:`;

                    const intentResponse = await ai.models.generateContent({
                        model: 'gemini-flash-lite-latest',
                        contents: [{ role: 'user', parts: [{ text: intentPrompt }] }],
                        config: { thinkingConfig: { thinkingBudget: 0 } }
                    });

                    let intentData = { intent: 'none', repo_name: null, file_name: null, file_content: null };
                    try {
                        const intentText = intentResponse.text?.trim() || '{}';
                        // Remove markdown code blocks if present
                        const cleanedIntent = intentText.replace(/```json\n?|\n?```/g, '').trim();
                        intentData = JSON.parse(cleanedIntent);
                        console.log('AI parsed intent:', intentData);
                    } catch (e) {
                        console.error('Failed to parse intent JSON:', e);
                        console.log('Raw intent response:', intentResponse.text);
                    }

                    // Handle based on intent
                    if (intentData.intent === 'create_repo') {
                        if (intentData.repo_name) {
                            functionName = 'create_repo';
                            args.name = intentData.repo_name;
                            console.log('Create repo with extracted name:', args);
                        } else {
                            console.log('Create repo intent but no name - asking for repo name');
                            return res.json({
                                response: `What would you like to name your new repository?<br><br>Just provide the repository name (e.g., "my-awesome-project")`,
                                awaitingInput: 'repo_name_for_create'
                            });
                        }
                    }
                    else if (intentData.intent === 'delete_repo') {
                        // Use extracted repo_name, or fall back to current repo context
                        let repoToDelete = intentData.repo_name || context?.currentRepo;
                        
                        if (repoToDelete) {
                            functionName = 'delete_repo';
                            // Check if repo_name already has username prefix
                            args.repo = repoToDelete.includes('/') 
                                ? repoToDelete 
                                : `${githubUsername}/${repoToDelete}`;
                            console.log('Delete repo with extracted name:', args);
                        } else {
                            console.log('Delete repo intent but no name - asking for repo name');
                            return res.json({
                                response: `Which repository would you like to delete?<br><br>Just provide the repository name (e.g., "hello-world")`,
                                awaitingInput: 'repo_name_for_delete'
                            });
                        }
                    }
                    else if (intentData.intent === 'list_repos') {
                        functionName = 'list_repos';
                        console.log('List repos intent detected');
                    }
                    else if (intentData.intent === 'list_tools') {
                        functionName = 'list_tools';
                        console.log('List tools intent detected');
                    }
                    else if (intentData.intent === 'create_file' || intentData.intent === 'update_file') {
                        if (intentData.file_name) {
                            functionName = 'update_file';
                            // Use repo_name if provided, otherwise use current repo context
                            let targetRepo = context?.currentRepo;
                            if (intentData.repo_name) {
                                // Check if repo_name already has username prefix
                                targetRepo = intentData.repo_name.includes('/') ? intentData.repo_name : `${githubUsername}/${intentData.repo_name}`;
                            }
                            
                            if (!targetRepo) {
                                console.log('File creation intent but no repo context');
                                return res.json({
                                    response: `Which repository should I create this file in?<br><br>Please select a repository first or specify it in your request.`
                                });
                            }
                            
                            // Generate appropriate file content using AI coding agent
                            let fileContent = intentData.file_content;
                            
                            if (!fileContent) {
                                console.log('=== CODING AGENT: Generating content for', intentData.file_name);
                                
                                const codingPrompt = `You are a coding agent. Generate appropriate starter/boilerplate code for the file: ${intentData.file_name}

File name: ${intentData.file_name}
Repository context: ${targetRepo}
User request: ${originalMessage}

Based on the file extension, generate ONLY the file content with NO explanations, NO markdown code blocks, NO additional text.

Rules:
- For .html files: Create a modern, clean HTML5 boilerplate
- For .css files: Create a basic CSS reset and starter styles
- For .js files: Create a clean JavaScript file with comments
- For .py files: Create a Python file with proper structure
- For .md files: Create a README with appropriate structure
- For .json files: Create valid JSON structure
- For .txt files: Create simple text content
- For other files: Generate appropriate content based on extension

Generate the raw file content NOW (no markdown, no explanations):`;

                                const codingResponse = await ai.models.generateContent({
                                    model: 'gemini-flash-lite-latest',
                                    contents: [{ role: 'user', parts: [{ text: codingPrompt }] }],
                                    config: { thinkingConfig: { thinkingBudget: 0 } }
                                });

                                fileContent = codingResponse.text?.trim() || '';
                                
                                // Remove markdown code blocks if AI added them despite instructions
                                fileContent = fileContent.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();
                                
                                console.log('Generated content length:', fileContent.length);
                                console.log('Generated content preview:', fileContent.substring(0, 200));
                            }
                            
                            args.repo = targetRepo;
                            args.path = intentData.file_name;
                            args.content = fileContent;
                            args.message = `Create ${intentData.file_name}`;
                            console.log('Create file with extracted params:', args);
                        } else {
                            console.log('File creation intent but no filename');
                            return res.json({
                                response: `What would you like to name the file?<br><br>Example: "index.html", "README.md", "script.js"`
                            });
                        }
                    }
                    else if (intentData.intent === 'delete_file') {
                        if (intentData.file_name) {
                            functionName = 'delete_file';
                            // Use repo_name if provided, otherwise use current repo context
                            let targetRepo = context?.currentRepo;
                            if (intentData.repo_name) {
                                // Check if repo_name already has username prefix
                                targetRepo = intentData.repo_name.includes('/') ? intentData.repo_name : `${githubUsername}/${intentData.repo_name}`;
                            }
                            
                            if (!targetRepo) {
                                console.log('File deletion intent but no repo context');
                                return res.json({
                                    response: `Which repository is this file in?<br><br>Please select a repository first or specify it in your request.`
                                });
                            }
                            
                            args.repo = targetRepo;
                            args.path = intentData.file_name;
                            args.message = `Delete ${intentData.file_name}`;
                            console.log('Delete file with extracted params:', args);
                        } else {
                            console.log('File deletion intent but no filename');
                            return res.json({
                                response: `Which file would you like to delete?<br><br>Please specify the filename.`
                            });
                        }
                    }

                    // If function was detected by manual parsing, execute it
                    if (functionName) {
                        console.log('Function detected, proceeding with execution');
                        console.log('Executing manually detected function:', functionName, 'with args:', args);
                        
                        // Handle delete_repo confirmation
                    if (functionName === 'delete_repo') {
                            // Check if repo exists
                        const repoCheckResponse = await githubFetch(`/repos/${args.repo}`);
                        if (!repoCheckResponse.ok) {
                            if (repoCheckResponse.status === 404) {
                                    return res.json({
                                        response: `Repository "${args.repo}" not found.`
                                    });
                            } else {
                            return res.json({
                                        response: `Error checking repository: ${repoCheckResponse.statusText}`
                            });
                                }
                        }
                        
                        // Repo exists, ask for confirmation
                        return res.json({
                                response: `DANGER: You are about to PERMANENTLY DELETE "${args.repo}"\n\nThis will delete ALL code, issues, and history forever.\n\nType "yes" to confirm deletion, or anything else to cancel.`,
                            pendingDeletion: args.repo
                        });
                        }
                        
                        const result = await executeTool(functionName, args);
                        console.log('Manual execution result:', result);

                        toolCalls.push({
                            name: functionName,
                            args: args,
                            result
                        });

                        console.log('Added manual tool call to toolCalls:', toolCalls[toolCalls.length - 1]);
                        
                        // Format the response based on the tool
                        const toolCall = toolCalls[0];
                        
                        if (functionName === 'list_tools' && toolCall.result.tools) {
                            console.log('=== FORMATTING LIST_TOOLS (MANUAL) ===');
                            responseText = "<strong>Here's what I can do:</strong><br><br>";
                            toolCall.result.tools.forEach((tool, index) => {
                                responseText += `${index + 1}. <strong>${tool.name}</strong>: ${tool.description}<br>`;
                            });
                            responseText += "<br>You can use these tools by clicking them in the sidebar, or by asking me in plain English!<br>For example: \"create a new repo called my-project\" or \"list my repositories\"";
                        } else if (functionName === 'list_repos') {
                            console.log('=== FORMATTING LIST_REPOS (MANUAL) ===');
                            console.log('list_repos result:', toolCall.result);
                            responseText = "<strong>Your GitHub Repositories:</strong><br><br>";
                            if (!toolCall.result.repos || toolCall.result.repos.length === 0) {
                                responseText += "You don't have any repositories yet.<br><br>Want to create one? Just ask!";
                            } else {
                                toolCall.result.repos.forEach((repo, index) => {
                                    responseText += `${index + 1}. <strong>${repo.name}</strong><br>`;
                                });
                                responseText += `<br>Total: ${toolCall.result.repos.length} ${toolCall.result.repos.length === 1 ? 'repository' : 'repositories'}`;
                            }
                        } else if (functionName === 'create_repo' && toolCall.result.success) {
                            console.log('=== FORMATTING CREATE_REPO (MANUAL) ===');
                            const repoName = args.name;
                            responseText = `Repository <strong>${repoName}</strong> created successfully.`;
                        } else if (functionName === 'delete_repo') {
                            console.log('=== FORMATTING DELETE_REPO (MANUAL) ===');
                            if (toolCall.result.error) {
                                // Check if repo name was extracted
                                if (!args.repo) {
                                    responseText = `I couldn't find the repository name in your request. Please specify which repository you want to delete.<br><br>Example: "delete the hello-world repo"`;
                } else {
                                    responseText = `Repository not found or couldn't be deleted: ${args.repo}`;
                                }
                            } else if (toolCall.result.success) {
                                responseText = `${toolCall.result.success}`;
                            } else {
                                responseText = `An error occurred while deleting the repository`;
                            }
                        } else if (functionName === 'update_file' && toolCall.result.success) {
                            console.log('=== FORMATTING UPDATE_FILE (MANUAL) ===');
                            const fileName = args.path;
                            responseText = `File <strong>${fileName}</strong> ${toolCall.result.success.includes('updated') ? 'updated' : 'created'} successfully.`;
                        } else if (functionName === 'delete_file' && toolCall.result.success) {
                            console.log('=== FORMATTING DELETE_FILE (MANUAL) ===');
                            const fileName = args.path;
                            responseText = `File <strong>${fileName}</strong> deleted successfully.`;
                        } else {
                            // For other tools, let AI handle response
                            responseText = responseTextContent;
                        }
                    } else {
                        // If no function was called by AI, return the AI's natural response
                        console.log('No function detected - returning AI response');
                        responseText = responseTextContent;
                        return res.json({
                            response: responseText
                        });
                    }
                }

            }
        }

        console.log('Reached end - responseText:', responseText);
        res.json({
            response: responseText,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.json({ error: error.message });
    }
});

// Direct API endpoints (kept for compatibility)
app.get('/repos', async (req, res) => {
    try {
        const result = await executeTool('list_repos', {});
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

app.get('/files', async (req, res) => {
    try {
        const repo = req.query.repo;
        if (!repo) {
            return res.json({ error: 'Repository parameter required (format: username/repo-name)' });
        }
        
        const path = req.query.path || '';
        const result = await executeTool('list_files', { repo, path });
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

app.get('/file', async (req, res) => {
    try {
        const repo = req.query.repo;
        const path = req.query.path;
        
        if (!repo || !path) {
            return res.json({ error: 'Repository and path parameters required' });
        }

        const result = await executeTool('read_file', { repo, path });
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

app.post('/commit', async (req, res) => {
    try {
        const { repo, content, filePath, message } = req.body;
        if (!repo) {
            return res.json({ error: 'Repository parameter required' });
        }
        
        const result = await executeTool('update_file', { 
            repo,
            path: filePath, 
            content, 
            message: message || `Update ${filePath}` 
        });
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Direct deletion endpoint (after confirmation)
app.post('/delete', async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) {
            return res.json({ error: 'Repository parameter required' });
        }
        
        const result = await executeTool('delete_repo', { repo });
        res.json(result);
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`GitHub Token: ${githubToken ? '✓ Configured' : '✗ Missing'}`);
    console.log(`Gemini API Key: ${geminiApiKey ? '✓ Configured' : '✗ Missing'}`);
    console.log(`GitHub Username: ${githubUsername}`);
});

module.exports = app;

