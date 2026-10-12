import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PositionDetails from './PositionDetails';

const interviewFlowResponse = {
    interviewFlow: {
        positionName: 'Senior Backend Engineer',
        interviewFlow: {
            id: 1,
            description: 'Standard development interview process',
            interviewSteps: [
                { id: 3, interviewFlowId: 1, interviewTypeId: 3, name: 'Entrevista técnica', orderIndex: 2 },
                { id: 1, interviewFlowId: 1, interviewTypeId: 1, name: 'Llamada telefónica', orderIndex: 1 },
                { id: 4, interviewFlowId: 1, interviewTypeId: 4, name: 'Entrevista manager', orderIndex: 3 },
            ],
        },
    },
};

const candidatesResponse = [
    { id: 1, applicationId: 1, fullName: 'John Doe', currentInterviewStep: 'Llamada telefónica', averageScore: 3 },
    { id: 2, applicationId: 2, fullName: 'Alice Johnson', currentInterviewStep: 'Llamada telefónica', averageScore: 3.6 },
    { id: 3, applicationId: 3, fullName: 'Jane Smith', currentInterviewStep: 'Entrevista técnica', averageScore: 4.5 },
];

const jsonResponse = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/positions/:id" element={<PositionDetails />} />
            </Routes>
        </MemoryRouter>
    );

describe('PositionDetails', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('renders the title, one column per stage in order, and candidates in their stage', async () => {
        jest.spyOn(global, 'fetch').mockImplementation((input) =>
            String(input).endsWith('/interviewflow')
                ? jsonResponse(interviewFlowResponse)
                : jsonResponse(candidatesResponse)
        );

        renderAt('/positions/1');

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Senior Backend Engineer' })
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Volver al listado de posiciones' })).toHaveAttribute(
            'href',
            '/positions'
        );

        const stages = screen.getAllByRole('region');
        expect(stages.map((stage) => within(stage).getByRole('heading', { level: 2 }).textContent)).toEqual([
            'Llamada telefónica',
            'Entrevista técnica',
            'Entrevista manager',
        ]);

        const [phone, technical, manager] = stages;
        expect(within(phone).getAllByRole('listitem').map((li) => li.querySelector('.candidate-name')?.textContent)).toEqual(
            ['John Doe', 'Alice Johnson']
        );
        expect(within(phone).getByRole('img', { name: 'Puntuación media: 3,6 de 5' }).children).toHaveLength(4);
        expect(within(technical).getByRole('img', { name: 'Puntuación media: 4,5 de 5' }).children).toHaveLength(5);
        expect(within(manager).queryByRole('listitem')).not.toBeInTheDocument();
        expect(within(manager).getByText('Sin candidatos en esta fase')).toBeInTheDocument();
    });

    describe('moving candidates between stages', () => {
        // jsdom has no layout: give each stage a column and each card a slot inside its column.
        beforeEach(() => {
            jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
                const column = this.closest('.stage-column');
                const columnIndex = column ? Array.from(column.parentElement!.children).indexOf(column) : 0;
                const left = columnIndex * 220;
                const rect = this.classList.contains('candidate-card')
                    ? { left: left + 10, top: 60, width: 180, height: 60 }
                    : this.classList.contains('stage-column')
                      ? { left, top: 0, width: 200, height: 400 }
                      : { left: 0, top: 0, width: 0, height: 0 };
                return {
                    ...rect,
                    x: rect.left,
                    y: rect.top,
                    right: rect.left + rect.width,
                    bottom: rect.top + rect.height,
                    toJSON: () => rect,
                } as DOMRect;
            });
        });

        const mockApi = (putResponse: Promise<Response>) =>
            jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
                if (init?.method === 'PUT') return putResponse;
                return String(input).endsWith('/interviewflow')
                    ? jsonResponse(interviewFlowResponse)
                    : jsonResponse(candidatesResponse);
            });

        // Mirrors a screen-reader user: wait for each announcement before the next key press.
        const moveWithKeyboard = async (cardName: string, arrowKey: string, targetStage: string) => {
            const card = (await screen.findByText(cardName)).closest('.candidate-card') as HTMLElement;
            const liveRegion = () => document.querySelector('[aria-live="assertive"]');
            card.focus();
            await act(async () => {
                fireEvent.keyDown(card, { code: 'Space' });
            });
            // Once the card reports being over its own stage, the stage positions have been measured.
            await waitFor(() => expect(liveRegion()).toHaveTextContent(`${cardName} está sobre la fase`));
            // The keyboard sensor starts listening for arrow keys one tick after the drag starts.
            await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
            await act(async () => {
                fireEvent.keyDown(card, { code: arrowKey });
            });
            await waitFor(() => expect(liveRegion()).toHaveTextContent(`está sobre la fase ${targetStage}`));
            await act(async () => {
                fireEvent.keyDown(card, { code: 'Space' });
            });
        };

        const stageOf = (cardName: string) =>
            screen.getByText(cardName).closest('section')?.querySelector('h2')?.textContent;

        it('moves a card to the next stage and saves it through PUT /candidates/:id', async () => {
            const fetchSpy = mockApi(jsonResponse({ message: 'Candidate stage updated successfully' }));
            renderAt('/positions/1');

            await moveWithKeyboard('Jane Smith', 'ArrowRight', 'Entrevista manager');

            await waitFor(() => expect(stageOf('Jane Smith')).toBe('Entrevista manager'));
            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:3010/candidates/3',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ applicationId: 3, currentInterviewStep: 4 }),
                })
            );
            expect(screen.queryByRole('alert')).toBeEmptyDOMElement();
        });

        it('returns the card to its stage and shows an error when saving fails', async () => {
            mockApi(jsonResponse({ message: 'Error updating candidate stage' }, 400));
            renderAt('/positions/1');

            await moveWithKeyboard('Jane Smith', 'ArrowLeft', 'Llamada telefónica');

            expect(await screen.findByText(/No se ha podido mover a Jane Smith/)).toBeInTheDocument();
            expect(stageOf('Jane Smith')).toBe('Entrevista técnica');
        });
    });

    it('shows a not-found message when the position does not exist', async () => {
        jest.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ message: 'Position not found' }, 404));

        renderAt('/positions/999');

        expect(await screen.findByRole('alert')).toHaveTextContent('No se ha encontrado la posición solicitada.');
    });

    it('does not call the API for an invalid position id', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');

        renderAt('/positions/abc');

        expect(await screen.findByRole('alert')).toHaveTextContent('No se ha encontrado la posición solicitada.');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
