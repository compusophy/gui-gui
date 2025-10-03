let currentFile = null;
let currentRepo = null;
let chatHistory = [];
let pendingDeletion = null;
let pendingDeletionType = null; // 'repo' or 'file'

// Tool execution function
async function executeTool(toolName, args = {}) {
    try {
        // Add loading message to chat
        const chatMessages = document.getElementById('chat-messages');
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'message assistant';
        loadingMsg.innerHTML = '<span class="loading"></span> Executing tool...';
        loadingMsg.id = 'tool-loading';
        chatMessages.appendChild(loadingMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Execute ${toolName} with args: ${JSON.stringify(args)}`,
                history: chatHistory
            })
        });

        const result = await response.json();

        // Remove loading message
        const loadingMsgEl = document.getElementById('tool-loading');
        if (loadingMsgEl) loadingMsgEl.remove();

        if (result.error) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'message system';
            errorMsg.textContent = `Error: ${result.error}`;
            chatMessages.appendChild(errorMsg);
        } else {
            const assistantMsg = document.createElement('div');
            assistantMsg.className = 'message assistant';
            assistantMsg.textContent = result.response;

            if (result.toolCalls && result.toolCalls.length > 0) {
                let toolHtml = '';
                result.toolCalls.forEach(tc => {
                    toolHtml += `<div class="tool-call">${tc.name}(${JSON.stringify(tc.args)})</div>`;
                });
                assistantMsg.innerHTML += toolHtml;
            }

            chatMessages.appendChild(assistantMsg);

            // Add to history
            chatHistory.push({
                role: 'model',
                parts: [{ text: result.response }]
            });
        }

        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (error) {
        const chatMessages = document.getElementById('chat-messages');
        const loadingMsgEl = document.getElementById('tool-loading');
        if (loadingMsgEl) loadingMsgEl.remove();

        const errorMsg = document.createElement('div');
        errorMsg.className = 'message system';
        errorMsg.textContent = `Error: ${error.message}`;
        chatMessages.appendChild(errorMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Create repo via chat
function showCreateRepoDialog() {
    const chatInput = document.getElementById('chat-input');
    chatInput.value = 'Create a new repository called ';
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// Create file via chat
function showCreateFileDialog() {
    if (!currentRepo) {
        console.log('No repository selected');
        return;
    }

    const chatInput = document.getElementById('chat-input');
    chatInput.value = `Create a new file called `;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// Show delete repo dialog
function showDeleteRepoDialog() {
    if (!currentRepo) {
        console.log('No repository selected - please select a repository first');
        return;
    }
    
    // Extract just the repo name from the full name (e.g., "compusophy-bot/test-repo" -> "test-repo")
    const repoName = currentRepo.split('/').pop();
    
    const chatInput = document.getElementById('chat-input');
    chatInput.value = `Delete the repository '${repoName}'`;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// Delete specific file via chat
function deleteFile(filePath) {
    const chatInput = document.getElementById('chat-input');
    chatInput.value = `Delete the file '${filePath}'`;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);

}

// Show delete file dialog
function showDeleteFileDialog() {
    if (!currentFile) {
        console.log('No file selected');
        return;
    }

    const chatInput = document.getElementById('chat-input');
    chatInput.value = `Delete the file '${currentFile.path}'`;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// Load repositories
async function loadRepositories() {
    const repoList = document.getElementById('repo-list');
    
    // Show loading state
    repoList.innerHTML = '';
    
    try {
        const response = await fetch('/repos');
        const data = await response.json();
        
        if (data.error) {
            repoList.innerHTML = `<div class="status error">${data.error}</div>`;
        } else if (data.repos) {
            renderRepoList(data.repos);
        } else {
            repoList.innerHTML = '<div class="empty-state">No repositories found</div>';
        }
    } catch (error) {
        repoList.innerHTML = `<div class="status error">Error: ${error.message}</div>`;
    }
}

function renderRepoList(repos) {
    const repoList = document.getElementById('repo-list');
    if (repos.length === 0) {
        repoList.innerHTML = '<div class="empty-state">No repositories found</div>';
        return;
    }

    let html = '';
    repos.forEach(repo => {
        const icon = repo.private ? '🔒' : '';
        const repoId = repo.fullName.replace('/', '-');
        html += `
            <div class="repo-item" data-repo-name="${repo.fullName}" onclick="selectRepository('${repo.fullName}')">
                ${icon}${icon ? ' ' : ''}${repo.name}
            </div>
        `;
    });
    repoList.innerHTML = html;
    htmx.process(repoList);
}

async function selectRepository(repoFullName) {
    // Remove active class from all repos
    document.querySelectorAll('.repo-item').forEach(item => {
        item.classList.remove('expanded');
    });

    // Add active class to selected repo
    const selectedRepo = document.querySelector(`.repo-item[data-repo-name="${repoFullName}"]`);
    if (selectedRepo) {
        selectedRepo.classList.add('expanded');
    }

    // Set current repo
    currentRepo = repoFullName;

    // Clear the current file and reset editor
    currentFile = null;
    document.getElementById('editor').value = '';
    document.getElementById('editor').disabled = true;

    // Load files for this repository
    const filesList = document.getElementById('files-list');
    filesList.innerHTML = '';

    try {
        const response = await fetch(`/files?repo=${encodeURIComponent(repoFullName)}`);
        const data = await response.json();

        if (data.error) {
            filesList.innerHTML = `<div class="status error">${data.error}</div>`;
        } else if (data.files) {
            renderFilesList(data.files);
        } else {
            filesList.innerHTML = '<div class="empty-state">No files found</div>';
        }
    } catch (error) {
        filesList.innerHTML = `<div class="status error">Error: ${error.message}</div>`;
    }
}

function renderFilesList(files) {
    const filesList = document.getElementById('files-list');
    
    if (files.length === 0) {
        filesList.innerHTML = '<div class="empty-state">No files in this repository</div>';
        return;
    }

    let html = '';
    files.forEach(file => {
        if (file.type === 'file') {
            const isActive = currentFile && currentFile.path === file.path ? 'active' : '';
            html += `
                <div class="file-item ${isActive}" data-file-path="${file.path}" onclick="loadFile('${file.path}')">
                    ${file.name}
                </div>
            `;
        } else if (file.type === 'dir') {
            html += `
                <div class="dir-item">
                    ${file.name}/
                </div>
            `;
        }
    });
    filesList.innerHTML = html;
}


// Create new file in specific repo
function createNewFileInRepo(repoFullName) {
    const chatInput = document.getElementById('chat-input');
    chatInput.value = 'Create a new file called ';
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);

    // Show instruction in chat
    console.log('Creating file in repo:', repoFullName);

    // Set current repo context
    currentRepo = repoFullName;
}

async function loadFile(filePath) {
    if (!currentRepo) {
        console.error('No repository selected');
        return;
    }

    console.log('Loading file:', filePath);

    try {
        const response = await fetch(`/file?repo=${encodeURIComponent(currentRepo)}&path=${encodeURIComponent(filePath)}`);
        const data = await response.json();

        if (data.error) {
            console.error('Error loading file:', data.error);
            return;
        }

        currentFile = {
            repo: currentRepo,
            path: filePath,
            content: data.content,
            sha: data.sha
        };

        // File loaded successfully
        document.getElementById('editor').value = data.content;
        document.getElementById('editor').disabled = false;

        // Update active file highlighting
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeFileItem = document.querySelector(`.file-item[data-file-path="${filePath}"]`);
        if (activeFileItem) {
            activeFileItem.classList.add('active');
        }

    } catch (error) {
        console.error('Error loading file:', error.message);
    }
}

let pendingCommit = false;

async function saveFile() {
    if (!currentFile) return;

    const content = document.getElementById('editor').value;
    const defaultMessage = `Update ${currentFile.path}`;
    
    // Send to chat as AI command
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    
    // Show in chat what we're doing
    const userMsg = document.createElement('div');
    userMsg.className = 'message user';
    userMsg.textContent = `Save file ${currentFile.path}`;
    chatMessages.appendChild(userMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'message assistant';
    loadingMsg.innerHTML = '<span class="loading"></span> Saving file...';
    loadingMsg.id = 'save-loading';
    chatMessages.appendChild(loadingMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch('/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repo: currentFile.repo,
                content: content,
                filePath: currentFile.path,
                message: defaultMessage
            })
        });

        const result = await response.json();

        const saveMsgEl = document.getElementById('save-loading');
        if (saveMsgEl) saveMsgEl.remove();

        const resultMsg = document.createElement('div');
        if (result.error) {
            resultMsg.className = 'message system';
            resultMsg.textContent = ` Error: ${result.error}`;
        } else {
            resultMsg.className = 'message assistant';
            resultMsg.textContent = ` File saved successfully!`;
            // Reload the file to get new SHA
            setTimeout(() => loadFile(currentFile.path), 500);
        }
        chatMessages.appendChild(resultMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;

    } catch (error) {
        const saveMsgEl = document.getElementById('save-loading');
        if (saveMsgEl) saveMsgEl.remove();

        const errorMsg = document.createElement('div');
        errorMsg.className = 'message system';
        errorMsg.textContent = ` Error: ${error.message}`;
        chatMessages.appendChild(errorMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function handleChatSubmit(event) {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message) {
        event.preventDefault();
        return;
    }

    // Check if we're waiting for deletion confirmation
    if (pendingDeletion) {
        event.preventDefault();
        
        const chatMessages = document.getElementById('chat-messages');
        
        // Add user message to chat
        const userMsg = document.createElement('div');
        userMsg.className = 'message user';
        userMsg.textContent = message;
        chatMessages.appendChild(userMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Clear input
        input.value = '';
        
        if (message.toLowerCase() === 'yes') {
            const isFileDelete = pendingDeletionType === 'file';
            const itemType = isFileDelete ? 'file' : 'repository';
            
            // Execute the deletion via direct endpoint
            const loadingMsg = document.createElement('div');
            loadingMsg.className = 'message assistant';
            loadingMsg.innerHTML = `<span class="loading"></span> Deleting ${itemType}...`;
            loadingMsg.id = 'delete-loading';
            chatMessages.appendChild(loadingMsg);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            if (isFileDelete) {
                // Parse repo and path from pendingDeletion
                const [repo, path] = pendingDeletion.split(':::');
                
                // Call delete_file via executeTool
                fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        message: `FORCE_DELETE_FILE:${repo}:${path}`,
                        history: chatHistory
                    })
                })
                .then(response => response.json())
                .then(result => {
                    const deleteMsgEl = document.getElementById('delete-loading');
                    if (deleteMsgEl) deleteMsgEl.remove();
                    
                    const resultMsg = document.createElement('div');
                    if (result.error) {
                        resultMsg.className = 'message system';
                        resultMsg.textContent = ` Error: ${result.error}`;
                    } else {
                        resultMsg.className = 'message assistant';
                        resultMsg.textContent = result.response || ` File deleted successfully`;
                        
                        // Refresh file list
                        if (currentRepo) {
                            currentFile = null;
                            document.getElementById('editor').value = '';
                            document.getElementById('editor').disabled = true;
                            setTimeout(() => selectRepository(currentRepo), 500);
                        }
                    }
                    chatMessages.appendChild(resultMsg);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                })
                .catch(error => {
                    const deleteMsgEl = document.getElementById('delete-loading');
                    if (deleteMsgEl) deleteMsgEl.remove();
                    
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'message system';
                    errorMsg.textContent = ` Error: ${error.message}`;
                    chatMessages.appendChild(errorMsg);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                });
            } else {
                // Call the delete repo endpoint directly
                fetch('/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo: pendingDeletion })
                })
                .then(response => response.json())
                .then(result => {
                    const deleteMsgEl = document.getElementById('delete-loading');
                    if (deleteMsgEl) deleteMsgEl.remove();
                    
                    const resultMsg = document.createElement('div');
                    if (result.error) {
                        resultMsg.className = 'message system';
                        resultMsg.textContent = ` Error: ${result.error}`;
                    } else {
                        resultMsg.className = 'message assistant';
                        resultMsg.textContent = ` ${result.success}`;
                    }
                    chatMessages.appendChild(resultMsg);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    
                    // Refresh repo list if visible
                    if (document.getElementById('repo-list').innerHTML) {
                        loadRepositories();
                    }
                })
                .catch(error => {
                    const deleteMsgEl = document.getElementById('delete-loading');
                    if (deleteMsgEl) deleteMsgEl.remove();
                    
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'message system';
                    errorMsg.textContent = ` Error: ${error.message}`;
                    chatMessages.appendChild(errorMsg);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                });
            }
            
            pendingDeletion = null;
            pendingDeletionType = null;
        } else {
            // Cancelled
            const cancelMsg = document.createElement('div');
            cancelMsg.className = 'message system';
            cancelMsg.textContent = ' Deletion cancelled';
            chatMessages.appendChild(cancelMsg);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            pendingDeletion = null;
            pendingDeletionType = null;
        }
        
        return;
    }

    // Normal message flow
    // Add user message to chat
    const chatMessages = document.getElementById('chat-messages');
    const userMsg = document.createElement('div');
    userMsg.className = 'message user';
    userMsg.textContent = message;
    chatMessages.appendChild(userMsg);
    
    // Add to history
    chatHistory.push({
        role: 'user',
        parts: [{ text: message }]
    });

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Clear input
    input.value = '';

    // Add loading message
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'message assistant';
    loadingMsg.innerHTML = '<span class="loading"></span> Thinking...';
    loadingMsg.id = 'loading-msg';
    chatMessages.appendChild(loadingMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleChatResponse(event) {
    const chatMessages = document.getElementById('chat-messages');

    // Remove loading message
    const loadingMsg = document.getElementById('loading-msg');
    if (loadingMsg) {
        loadingMsg.remove();
    }

            if (event.detail.successful) {
        try {
            const response = JSON.parse(event.detail.xhr.responseText);

            if (response.error) {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'message system';
                errorMsg.textContent = `Error: ${response.error}`;
                chatMessages.appendChild(errorMsg);
            } else if (response.response) {
                const assistantMsg = document.createElement('div');
                assistantMsg.className = 'message assistant';

                // Check if this is a deletion confirmation request
                if (response.pendingDeletion) {
                    assistantMsg.style.background = '#fff3cd';
                    assistantMsg.style.color = '#856404';
                    assistantMsg.style.borderLeft = '3px solid #ff9800';
                    assistantMsg.style.fontWeight = '600';
                    pendingDeletion = response.pendingDeletion;
                    pendingDeletionType = response.deletionType || 'repo';
                }

                // Clean up the response - extract clean text from any JSON structure
                let cleanResponse = response.response;

                // Handle different response formats
                if (typeof cleanResponse === 'string') {
                    // If it's already a clean string, use it
                    if (!cleanResponse.startsWith('{')) {
                        // Already clean text
                    } else {
                        // Try to parse as JSON
                        try {
                            const jsonResponse = JSON.parse(cleanResponse);
                            if (jsonResponse && typeof jsonResponse === 'object') {
                                if (jsonResponse.response) {
                                    cleanResponse = jsonResponse.response;
                                } else if (jsonResponse.message) {
                                    cleanResponse = jsonResponse.message;
                                } else if (jsonResponse.text) {
                                    cleanResponse = jsonResponse.text;
                                } else {
                                    // If it's a JSON object but doesn't have response/message/text, use the original
                                    cleanResponse = response.response;
                                }
                            } else {
                                // If parsed JSON is not an object, use the original
                                cleanResponse = response.response;
                            }
                        } catch (e) {
                            // If parsing fails, use the original response
                            console.log('Failed to parse response as JSON:', e);
                        }
                    }
                } else if (typeof cleanResponse === 'object') {
                    // If it's an object, try to extract the response text
                    if (cleanResponse.response) {
                        cleanResponse = cleanResponse.response;
                    } else if (cleanResponse.message) {
                        cleanResponse = cleanResponse.message;
                    } else if (cleanResponse.text) {
                        cleanResponse = cleanResponse.text;
                    } else {
                        // If it's an object but doesn't have response/message/text, use the original
                        cleanResponse = response.response;
                    }
                }

                assistantMsg.textContent = cleanResponse;

            chatMessages.appendChild(assistantMsg);

            // Refresh UI based on successful operations
            if (response.toolCalls && response.toolCalls.length > 0) {
                response.toolCalls.forEach(tc => {
                    if (tc.result && !tc.result.error) {
                        // Refresh repository list after creating a repo
                        if (tc.name === 'create_repo') {
                            const newRepoName = tc.args.name;
                            setTimeout(() => {
                                loadRepositories();
                                // Expand the newly created repo after a short delay
                                setTimeout(() => {
                                    const newRepoElement = Array.from(document.querySelectorAll('.repo-item')).find(el =>
                                        el.textContent.trim().includes(newRepoName)
                                    );
                                    if (newRepoElement && !newRepoElement.classList.contains('expanded')) {
                                        newRepoElement.click();
                                    }
                                }, 500);
                            }, 500);
                        }
                        // Refresh file list after creating a file
                        else if (tc.name === 'update_file' && tc.args.path) {
                            if (currentRepo) {
                                // Refresh the files list
                                selectRepository(currentRepo);
                                // Load the newly created file in the editor
                                setTimeout(() => loadFile(tc.args.path), 1000);
                            }
                        }
                        // Refresh file list after deleting a file
                        else if (tc.name === 'delete_file') {
                            if (currentRepo) {
                                // Clear the editor
                                currentFile = null;
                                document.getElementById('editor').value = '';
                                document.getElementById('editor').disabled = true;
                                // Refresh the files list
                                setTimeout(() => selectRepository(currentRepo), 500);
                            }
                        }
                    }
                });
            }

            // Add to history (unless it's a pending deletion)
            if (!response.pendingDeletion) {
                chatHistory.push({
                    role: 'model',
                    parts: [{ text: response.response }]
                });
            }
            }
        } catch (parseError) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'message system';
            errorMsg.textContent = `Error parsing response: ${parseError.message}`;
            chatMessages.appendChild(errorMsg);
        }
    } else {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'message system';
        errorMsg.textContent = `Request failed: ${event.detail.xhr.status} ${event.detail.xhr.statusText}`;
        chatMessages.appendChild(errorMsg);
    }

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Prevent htmx from doing its own swap
    event.preventDefault();
}

// Auto-load repositories after htmx loads the app
document.addEventListener('htmx:afterSwap', function(event) {
    // Only run on initial page load (when body swaps in app.html)
    if (event.target.tagName === 'BODY') {
        loadRepositories();
        
        // Now that the form exists, attach the config listener
        const chatForm = document.getElementById('chat-form');
        if (chatForm) {
            htmx.on(chatForm, 'htmx:configRequest', function(event) {
                event.detail.parameters.history = JSON.stringify(chatHistory);
                
                // Add context about current state
                const context = {
                    currentRepo: currentRepo,
                    currentFile: currentFile ? {
                        repo: currentFile.repo,
                        path: currentFile.path,
                        content: document.getElementById('editor').value
                    } : null
                };
                event.detail.parameters.context = JSON.stringify(context);
            });
        }
    }
});

