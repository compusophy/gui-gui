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
        name: 'list_repos',
        description: 'CALL THIS to list/show all GitHub repositories. Required when user asks to list/show repos.',
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
    }
];

// Tool execution functions
async function executeTool(toolName, args) {
    try {
        switch (toolName) {
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
        const { message, history, context } = req.body;

        if (!geminiApiKey) {
            return res.json({ error: 'GEMINI_API_KEY not configured' });
        }

        if (!githubToken) {
            return res.json({ error: 'GITHUB_TOKEN not configured' });
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
        
        const systemPrompt = `You are a GitHub AI agent. You MUST use the provided tools to perform actions. Be smart and ask clarifying questions if needed.

AVAILABLE TOOLS:
- list_repos() - Lists all repositories
- create_repo(name, description, private) - Creates a new repository
- delete_repo(repo) - Deletes a repository (format: username/repo-name)
- list_files(repo, path) - Lists files in a repo
- read_file(repo, path) - Reads a file
- update_file(repo, path, content, message) - Updates OR CREATES a file (creates if doesn't exist)

IMPORTANT RULES:
1. When user has a file open and says "update this", "change the readme", etc. - use the CURRENT CONTEXT below
2. If user says "create a new file", use update_file with the new filename and content
3. If unclear which repo/file they mean, ASK a clarifying question instead of guessing
4. When user wants to do something across "all repos", first call list_repos(), then iterate through each one
5. Use the current file content as a starting point when making edits
6. For new files, provide appropriate default content if not specified
7. Call tools directly - don't just describe what you would do${contextInfo}

When ready to act, output ONLY the function call. NO explanations, NO code blocks, NO backticks.`;

        const contents = [];
        
        // Add history if provided
        if (history && Array.isArray(history)) {
            contents.push(...history);
        }
        
        // Add current message
        contents.push({
            role: 'user',
            parts: [{ text: message }]
        });

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

        if (functionCalls && functionCalls.length > 0) {
            // Execute all function calls
            for (const functionCall of functionCalls) {
                const result = await executeTool(functionCall.name, functionCall.args);
                toolCalls.push({
                    name: functionCall.name,
                    args: functionCall.args,
                    result
                });
            }

            // Make another call with the function results
            const functionResponseParts = toolCalls.map(tc => ({
                functionResponse: {
                    name: tc.name,
                    response: tc.result
                }
            }));

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
        } else {
            // Check if response has candidates structure
            let responseTextContent = response.text || '';

            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                const content = response.candidates[0].content;
                if (content.parts && content.parts[0] && content.parts[0].text) {
                    responseTextContent = content.parts[0].text;
                }
            }

            console.log('Response text content:', responseTextContent);

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

                if (functionCallMatch) {
                    const functionName = functionCallMatch[1];
                    let args = {};

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

                    console.log('Parsed function:', functionName, 'with args:', args);

                    // Check if this is a destructive operation
                    if (functionName === 'delete_repo') {
                        // First, check if the repo exists
                        const repoCheckResponse = await githubFetch(`/repos/${args.repo}`);
                        
                        if (!repoCheckResponse.ok) {
                            if (repoCheckResponse.status === 404) {
                                responseText = `❌ Repository "${args.repo}" not found. Cannot delete a repository that doesn't exist.`;
                            } else {
                                responseText = `❌ Error checking repository: ${repoCheckResponse.statusText}`;
                            }
                            
                            return res.json({
                                response: responseText
                            });
                        }
                        
                        // Repo exists, ask for confirmation
                        responseText = `⚠️ DANGER: You are about to PERMANENTLY DELETE "${args.repo}"\n\nThis will delete ALL code, issues, and history forever.\n\nType "yes" to confirm deletion, or anything else to cancel.`;
                        
                        // Return special structure so frontend knows to wait for confirmation
                        return res.json({
                            response: responseText,
                            pendingDeletion: args.repo
                        });
                    } else {
                        // Execute the function call
                        const result = await executeTool(functionName, args);
                        toolCalls.push({
                            name: functionName,
                            args: args,
                            result
                        });

                        responseText = `Action completed: ${functionName}`;
                    }
                } else {
                    responseText = responseTextContent || 'No response generated';
                }
            }
        }

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

