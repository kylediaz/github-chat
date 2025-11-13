import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText, UIMessage, tool as createTool, smoothStream } from 'ai';
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
    const { messages }: { messages: UIMessage[] } = await req.json();
    console.log(messages);
    try {
        const httpTransport = new StreamableHTTPClientTransport(
            new URL('https://mcp.trychroma.com/package-search/v1'),
            {
                requestInit: {
                    headers: {
                        'x-chroma-token': process.env.CHROMA_API_KEY || '',
                    }
                }
            }
        );
        
        const codeSearchTool = await createMCPClient({
            transport: httpTransport as any,
        });

        const tools = {
            ...(await codeSearchTool.tools()),
            formatCode: createTool<{
                language: string,
                code: string
            }>({
                description: 'Format the code',
                inputSchema: z.object({
                    language: z.string(),
                    code: z.string(),
                }),
            }),
        }

        const result = streamText({
            model: openai('gpt-4.1'),
            system: 'You are a helpful assistant. Prefer to use the package_search_grep tool to answer questions about packages. Make 2 to 3 tool calls in order to get the information you need. Keep your answers concise - less than 6 sentences.',
            messages: convertToModelMessages(messages),
            tools: tools,
            // Close the MCP client after the response is finished
            onFinish: async () => {
                await codeSearchTool.close();
            },
            // Close the MCP client on error
            onError: async (error) => {
                await codeSearchTool.close();
            },
            stopWhen: stepCountIs(5),
        });

        return result.toUIMessageStreamResponse({
            sendReasoning: true,
            onError: (error) => {
                return `An error occurred, please try again! ${error}`;
            },
        });
    } catch (error) {
        console.error('MCP Client Error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}