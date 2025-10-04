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
        const { message, history, context } = req.body;

        if (!geminiApiKey) {
            return res.json({ error: 'GEMINI_API_KEY not configured' });
        }

        if (!githubToken) {
            return res.json({ error: 'GITHUB_TOKEN not configured' });
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
        
        const systemPrompt = `You are a helpful GitHub AI assistant. You can have casual conversations AND execute GitHub operations using tools.

BE CONVERSATIONAL for greetings and small talk:
- "hello", "hi", "hey" → Just respond naturally, be friendly
- General questions that don't need tools → Respond conversationally

USE TOOLS when users want to see information or do actions:
- "what can you do", "show tools", "list tools", "help", "capabilities" → list_tools()
- "list repositories", "show repos" → list_repos()
- "create repo/repository" → create_repo()
- "delete repo/repository" → delete_repo()
- "list files", "show files" → list_files()
- "read file", "show file" → read_file()
- "create file", "update file", "edit file" → update_file()
- "delete file" → delete_file()

IMPORTANT CONTEXT:${contextInfo}

When executing a tool, output ONLY the function call. NO explanations, NO code blocks, NO backticks.
When being conversational, just respond naturally like a helpful assistant.`;

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

            // For list_tools, format the response directly without AI follow-up
            if (toolCalls.length === 1 && toolCalls[0].name === 'list_tools' && toolCalls[0].result.tools) {
                console.log('=== FORMATTING LIST_TOOLS FROM FUNCTION CALL ===');
                console.log('Tools count:', toolCalls[0].result.tools.length);
                responseText = "<strong>Here's what I can do:</strong><br><br>";
                toolCalls[0].result.tools.forEach((tool, index) => {
                    responseText += `${index + 1}. <strong>${tool.name}</strong>: ${tool.description}<br>`;
                });
                responseText += "<br>You can use these tools by clicking them in the sidebar, or by asking me in plain English!<br>For example: \"create a new repo called my-project\" or \"list my repositories\"";
                console.log('=== FORMATTED RESPONSE ===');
                console.log(responseText);
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
                    
                    // If no function was called by AI, return the AI's natural response
                    if (!functionName) {
                        responseText = responseTextContent;
                        return res.json({
                            response: responseText
                        });
                    }
                    
                    if (originalMessage.toLowerCase().includes("delete the repository")) {
                        functionName = 'delete_repo';
                        // Extract repository name from quotes or after "repository "
                        let repoMatch = originalMessage.match(/[Dd]elete the repository ['"](.+?)['"]/);
                        console.log('Regex with quotes result:', repoMatch);
                        if (!repoMatch) {
                            // Try without quotes
                            repoMatch = originalMessage.match(/[Dd]elete the repository\s+(\S+)/);
                            console.log('Regex without quotes result:', repoMatch);
                        }
                        if (repoMatch) {
                            args.repo = `${githubUsername}/${repoMatch[1]}`;
                            console.log('Extracted delete repo args:', args);
                        } else {
                            console.log('Failed to extract repo name from:', originalMessage);
                        }
                    } else if (cleanedText.includes("Delete the repository")) {
                        functionName = 'delete_repo';
                        // Extract repository name from quotes or after "repository "
                        let repoMatch = cleanedText.match(/Delete the repository ['"](.+?)['"]/);
                        if (!repoMatch) {
                            // Try without quotes
                            repoMatch = cleanedText.match(/Delete the repository\s+(\S+)/);
                        }
                        if (repoMatch) {
                            args.repo = `${githubUsername}/${repoMatch[1]}`;
                            console.log('Extracted delete repo args from cleaned text:', args);
                        }
                    } else if (cleanedText.includes("Create a new repository called")) {
                        functionName = 'create_repo';
                        // Extract repository name from quotes or after "called "
                        let repoMatch = cleanedText.match(/Create a new repository called ['"](.+?)['"]/);
                        if (!repoMatch) {
                            repoMatch = cleanedText.match(/Create a new repository called\s+(\S+)/);
                        }
                        if (repoMatch) {
                            args.name = repoMatch[1];
                        }
                    } else if (originalMessage.toLowerCase().includes("delete the file")) {
                        functionName = 'delete_file';
                        // Extract file name from quotes or after "file "
                        let fileMatch = originalMessage.match(/[Dd]elete the file ['"](.+?)['"]/);
                        console.log('Regex with quotes result for file:', fileMatch);
                        if (!fileMatch) {
                            // Try without quotes
                            fileMatch = originalMessage.match(/[Dd]elete the file\s+(\S+)/);
                            console.log('Regex without quotes result for file:', fileMatch);
                        }
                        if (fileMatch) {
                            args.path = fileMatch[1];
                            console.log('Extracted delete file args:', args);
                        } else {
                            console.log('Failed to extract file name from:', originalMessage);
                        }
                    } else if (cleanedText.includes("Delete the file")) {
                        functionName = 'delete_file';
                        // Extract file name from quotes or after "file "
                        let fileMatch = cleanedText.match(/Delete the file ['"](.+?)['"]/);
                        if (!fileMatch) {
                            // Try without quotes
                            fileMatch = cleanedText.match(/Delete the file\s+(\S+)/);
                        }
                        if (fileMatch) {
                            args.path = fileMatch[1];
                            console.log('Extracted delete file args from cleaned text:', args);
                        }
                    } else if (cleanedText.includes("Create a new file called")) {
                        functionName = 'update_file';
                        // Extract filename from quotes or after "called "
                        let fileMatch = cleanedText.match(/Create a new file called ['"](.+?)['"]/);
                        if (!fileMatch) {
                            fileMatch = cleanedText.match(/Create a new file called\s+(\S+)/);
                        }
                        if (fileMatch) {
                            args.path = fileMatch[1];
                            args.content = `# ${fileMatch[1]}\n\nCreated by GitHub AI Agent\n\nAdd your content here...`;
                            args.message = `Create ${fileMatch[1]}`;
                        }
                    }
                }

                if (functionName) {
                    console.log('Parsed function:', functionName, 'with args:', args);

                    // Use context to fill in missing arguments
                    if (context) {
                        try {
                            const ctx = JSON.parse(context);
                            console.log('Context parsed:', ctx);
                            
                            // For delete_repo, use currentRepo if repo not in args
                            if (functionName === 'delete_repo' && !args.repo && ctx.currentRepo) {
                                args.repo = ctx.currentRepo;
                                console.log('Using context repo for delete_repo:', args.repo);
                            }
                            
                            // For delete_file, use currentFile if path not in args
                            if (functionName === 'delete_file' && !args.path && ctx.currentFile) {
                                args.repo = ctx.currentFile.repo;
                                args.path = ctx.currentFile.path;
                                console.log('Using context file for delete_file:', args);
                            }
                            
                            // For other file operations, use the current repository context
                            if (ctx.currentRepo && !args.repo) {
                                if (functionName === 'update_file' || functionName === 'read_file' || functionName === 'list_files') {
                                    args.repo = ctx.currentRepo;
                                    console.log('Using context repo:', args.repo);
                                }
                            }
                        } catch (e) {
                            console.error('Failed to parse context for args:', e);
                        }
                    }

                    // Validate required arguments
                    if (functionName === 'delete_repo' && !args.repo) {
                        responseText = `❌ Please select a repository first, or specify it in your request. Example: "Delete the repository 'repository-name'"`;
                        return res.json({
                            response: responseText
                        });
                    } else if (functionName === 'delete_file' && (!args.repo || !args.path)) {
                        responseText = `❌ Please select a file first, or specify it in your request. Example: "Delete the file 'filename.txt'"`;
                        return res.json({
                            response: responseText
                        });
                    } else if (functionName === 'create_repo' && !args.name) {
                        responseText = `❌ Please specify a repository name. Example: "Create a new repository called 'my-repo'"`;
                        return res.json({
                            response: responseText
                        });
                    } else if (functionName === 'update_file' && (!args.path || !args.content)) {
                        responseText = `❌ Please specify a filename and content. Example: "Create a new file called 'myfile.txt'"`;
                        return res.json({
                            response: responseText
                        });
                    }

                    // For file operations, we need a current repository context
                    if ((functionName === 'update_file' || functionName === 'read_file' || functionName === 'list_files' || functionName === 'delete_file') && !args.repo) {
                        responseText = `❌ Please select a repository first, or specify it in your request.`;
                        return res.json({
                            response: responseText
                        });
                    }

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
                    } else if (functionName === 'delete_file') {
                        // First, check if the file exists
                        const fileCheckResponse = await githubFetch(`/repos/${args.repo}/contents/${args.path}`);
                        
                        if (!fileCheckResponse.ok) {
                            if (fileCheckResponse.status === 404) {
                                responseText = `❌ File "${args.path}" not found in repository "${args.repo}". Cannot delete a file that doesn't exist.`;
                            } else {
                                responseText = `❌ Error checking file: ${fileCheckResponse.statusText}`;
                            }
                            
                            return res.json({
                                response: responseText
                            });
                        }
                        
                        // File exists, ask for confirmation
                        responseText = `⚠️ WARNING: You are about to PERMANENTLY DELETE "${args.path}"\n\nThis will delete the file from "${args.repo}" forever.\n\nType "yes" to confirm deletion, or anything else to cancel.`;
                        
                        // Return special structure so frontend knows to wait for confirmation
                        // Store both repo and path in pendingDeletion
                        return res.json({
                            response: responseText,
                            pendingDeletion: `${args.repo}:::${args.path}`,
                            deletionType: 'file'
                        });
                    } else {
                        // Execute the function call
                        const result = await executeTool(functionName, args);
                        toolCalls.push({
                            name: functionName,
                            args: args,
                            result
                        });

                        // For list_tools, format the response nicely
                        if (functionName === 'list_tools' && result.tools) {
                            console.log('Formatting list_tools response, tools:', result.tools.length);
                            responseText = "<strong>Here's what I can do:</strong><br><br>";
                            result.tools.forEach((tool, index) => {
                                responseText += `${index + 1}. <strong>${tool.name}</strong>: ${tool.description}<br>`;
                            });
                            responseText += "<br>You can use these tools by clicking them in the sidebar, or by asking me in plain English!<br>For example: \"create a new repo called my-project\" or \"list my repositories\"";
                            console.log('Formatted response:', responseText);
                        } else {
                            responseText = `Action completed: ${functionName}`;
                        }
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

