export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3010';

export type InterviewStep = {
    id: number;
    interviewFlowId: number;
    interviewTypeId: number;
    name: string;
    orderIndex: number;
};

export type PositionInterviewFlow = {
    positionName: string;
    interviewFlow: {
        id: number;
        description: string;
        interviewSteps: InterviewStep[];
    };
};

export type PositionCandidate = {
    id: number;
    applicationId: number;
    fullName: string;
    currentInterviewStep: string;
    averageScore: number;
};

export class PositionNotFoundError extends Error {}

const getJson = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        signal,
        headers: { Accept: 'application/json' },
    });
    if (response.status === 404) {
        throw new PositionNotFoundError('Position not found');
    }
    if (!response.ok) {
        throw new Error(`Request to ${path} failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
};

export const getPositionInterviewFlow = async (positionId: number, signal?: AbortSignal) => {
    const data = await getJson<{ interviewFlow: PositionInterviewFlow }>(
        `/position/${positionId}/interviewflow`,
        signal
    );
    return data.interviewFlow;
};

export const getPositionCandidates = (positionId: number, signal?: AbortSignal) =>
    getJson<PositionCandidate[]>(`/position/${positionId}/candidates`, signal);

export const updateCandidateStage = async (
    candidateId: number,
    applicationId: number,
    interviewStepId: number
): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/candidates/${candidateId}`, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, currentInterviewStep: interviewStepId }),
    });
    if (!response.ok) {
        throw new Error(`Updating candidate ${candidateId} failed with status ${response.status}`);
    }
};
