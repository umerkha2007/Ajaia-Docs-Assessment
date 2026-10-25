Tasks
-----

Build a small full stack application that includes the following core capabilities:

### 1\. Document Creation and Editing

Users should be able to:

*   Create a new document
    
*   Rename a document
    
*   Edit document content in a browser
    
*   Save and reopen documents
    

The editing experience should support basic rich-text formatting such as:

*   Bold
    
*   Italic
    
*   Underline
    
*   Headings or text size variation
    
*   Bulleted or numbered lists
    

You do not need to match Google Docs exactly, but the editing flow should feel usable and coherent.

### 2\. File Upload

Allow a user to upload at least one file into the product workflow. You may choose the exact behavior, but it should be product-relevant. Examples include:

*   Uploading a .txt, .md, or .docx file and turning it into a new editable document
    
*   Uploading an attachment that is associated with a document
    
*   Importing content from a file into an existing draft
    

If you limit supported file types, state that clearly in the UI and README.

### 3\. Sharing

Implement a simple sharing model so that one user can share a document with another. This does not need to be enterprise-grade access control, but it should demonstrate clear intent and working logic.

At minimum, include:

*   A document owner
    
*   A way to grant another user access
    
*   A visible distinction between owned and shared documents
    

You may simulate users with seeded accounts, mocked auth, or a lightweight login flow if that keeps the scope reasonable.

### 4\. Persistence

Persist documents and sharing data so that:

*   Documents remain available after refresh
    
*   Formatting or structure is preserved in a reasonable way
    
*   Shared access behavior can be demonstrated
    

You may use any practical storage approach for this scope, including SQLite, Postgres, Supabase, or a local file-based store if well documented.


Deliverables
------------

Submit one Google Drive folder containing:

*   The source code
    
*   A README.md with local setup and run instructions
    
*   A short architecture note in Markdown or PDF
    
*   Your AI workflow note in Markdown or PDF


Output Format
-----------------

*   Clear instructions for how to run the project locally
    

If any feature is partial or incomplete, state:

*   What is working
    
*   What is incomplete
    
*   What you would build next with another 2-4 hours
    

Constraints
-----------

*   Keep the project intentionally scoped
    
*   Do not try to build every Google Docs feature
    
*   Prioritize depth in a few important areas over shallow coverage everywhere
    
*   You may use any language, framework, editor library, or tooling stack

    