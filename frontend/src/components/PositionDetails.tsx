import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    Announcements,
    CollisionDetection,
    DndContext,
    DragEndEvent,
    KeyboardCoordinateGetter,
    KeyboardSensor,
    MouseSensor,
    pointerWithin,
    rectIntersection,
    TouchSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    getPositionCandidates,
    getPositionInterviewFlow,
    InterviewStep,
    PositionCandidate,
    PositionNotFoundError,
    updateCandidateStage,
} from '../services/positionService';
import './PositionDetails.css';

const MAX_SCORE = 5;
const scoreFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | {
          status: 'success';
          positionName: string;
          steps: InterviewStep[];
          candidates: PositionCandidate[];
      };

type CandidateDragData = { name: string; stepId: number };
type StageDropData = { name: string };

const ScoreDots: React.FC<{ score: number }> = ({ score }) => {
    const filled = Math.min(MAX_SCORE, Math.max(0, Math.round(score)));
    return (
        <span
            className="score-dots"
            role="img"
            aria-label={`Puntuación media: ${scoreFormatter.format(score)} de ${MAX_SCORE}`}
        >
            {Array.from({ length: filled }, (_, i) => (
                <span key={i} className="score-dot" />
            ))}
        </span>
    );
};

// Pointer drops use the pointer position; keyboard drags have no pointer, so fall back to the dragged card's rect.
const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
};

const screenReaderInstructions = {
    draggable:
        'Para mover al candidato a otra fase, pulsa espacio o intro. Usa las flechas para cambiar de fase, ' +
        'pulsa espacio o intro para soltarlo, o escape para cancelar.',
};

const announcements: Announcements = {
    onDragStart: ({ active }) => `Has cogido a ${(active.data.current as CandidateDragData).name}.`,
    onDragOver: ({ active, over }) => {
        const name = (active.data.current as CandidateDragData).name;
        return over
            ? `${name} está sobre la fase ${(over.data.current as StageDropData).name}.`
            : `${name} no está sobre ninguna fase.`;
    },
    onDragEnd: ({ active, over }) => {
        const name = (active.data.current as CandidateDragData).name;
        return over
            ? `${name} se ha soltado en la fase ${(over.data.current as StageDropData).name}.`
            : `${name} se ha soltado fuera de las fases y no se ha movido.`;
    },
    onDragCancel: ({ active }) =>
        `Movimiento cancelado. ${(active.data.current as CandidateDragData).name} sigue en su fase.`,
};

const CandidateCard: React.FC<{ candidate: PositionCandidate; stepId: number; saving: boolean }> = ({
    candidate,
    stepId,
    saving,
}) => {
    const data: CandidateDragData = { name: candidate.fullName, stepId };
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: candidate.applicationId,
        data,
        disabled: saving,
        attributes: { roleDescription: 'candidato arrastrable' },
    });

    const className = [
        'candidate-card',
        isDragging ? 'candidate-card--dragging' : '',
        saving ? 'candidate-card--saving' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <li>
            <div
                ref={setNodeRef}
                className={className}
                style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
                aria-busy={saving}
                {...attributes}
                {...listeners}
            >
                <span className="candidate-name">{candidate.fullName}</span>
                <ScoreDots score={candidate.averageScore} />
            </div>
        </li>
    );
};

const StageColumn: React.FC<{
    step: InterviewStep;
    candidates: PositionCandidate[];
    savingIds: ReadonlySet<number>;
}> = ({ step, candidates, savingIds }) => {
    const data: StageDropData = { name: step.name };
    const { setNodeRef, isOver } = useDroppable({ id: step.id, data });
    const headingId = `stage-${step.id}-title`;

    return (
        <section
            ref={setNodeRef}
            className={isOver ? 'stage-column stage-column--over' : 'stage-column'}
            aria-labelledby={headingId}
        >
            <h2 id={headingId} className="stage-title">
                {step.name}
            </h2>
            {candidates.length > 0 ? (
                <ul className="candidate-list">
                    {candidates.map((candidate) => (
                        <CandidateCard
                            key={candidate.applicationId}
                            candidate={candidate}
                            stepId={step.id}
                            saving={savingIds.has(candidate.applicationId)}
                        />
                    ))}
                </ul>
            ) : (
                <p className="visually-hidden">Sin candidatos en esta fase</p>
            )}
        </section>
    );
};

const PositionDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(() => new Set());
    const [moveError, setMoveError] = useState<string | null>(null);

    useEffect(() => {
        const positionId = Number(id);
        if (!Number.isInteger(positionId) || positionId <= 0) {
            setState({ status: 'error', message: 'No se ha encontrado la posición solicitada.' });
            return;
        }

        const controller = new AbortController();
        setState({ status: 'loading' });

        Promise.all([
            getPositionInterviewFlow(positionId, controller.signal),
            getPositionCandidates(positionId, controller.signal),
        ])
            .then(([flow, candidates]) => {
                const steps = [...flow.interviewFlow.interviewSteps].sort(
                    (a, b) => a.orderIndex - b.orderIndex || a.id - b.id
                );
                setState({ status: 'success', positionName: flow.positionName, steps, candidates });
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                setState({
                    status: 'error',
                    message:
                        error instanceof PositionNotFoundError
                            ? 'No se ha encontrado la posición solicitada.'
                            : 'No se ha podido cargar el proceso de selección. Inténtalo de nuevo más tarde.',
                });
            });

        return () => controller.abort();
    }, [id]);

    const positionName = state.status === 'success' ? state.positionName : undefined;

    useEffect(() => {
        if (positionName) {
            document.title = `${positionName} – Proceso de selección`;
        }
    }, [positionName]);

    const steps = state.status === 'success' ? state.steps : undefined;

    const candidatesByStep = useMemo(() => {
        const groups = new Map<string, PositionCandidate[]>();
        if (state.status !== 'success') return groups;
        for (const candidate of state.candidates) {
            const group = groups.get(candidate.currentInterviewStep);
            if (group) {
                group.push(candidate);
            } else {
                groups.set(candidate.currentInterviewStep, [candidate]);
            }
        }
        return groups;
    }, [state]);

    // Arrow keys jump the dragged card to the previous/next stage instead of moving it pixel by pixel.
    const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>(
        (event, { context: { active, over, droppableRects, collisionRect } }) => {
            const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.code];
            if (!direction || !steps || !active || !collisionRect) return undefined;
            event.preventDefault();

            const currentStepId = over ? Number(over.id) : (active.data.current as CandidateDragData).stepId;
            const currentIndex = steps.findIndex((step) => step.id === currentStepId);
            const target = steps[currentIndex + direction];
            const targetRect = target && droppableRects.get(target.id);
            if (!targetRect) return undefined;

            return {
                x: targetRect.left + (targetRect.width - collisionRect.width) / 2,
                y: targetRect.top + Math.min(48, Math.max(0, targetRect.height - collisionRect.height)),
            };
        },
        [steps]
    );

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        // The delay keeps vertical page scrolling working on touch screens.
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
    );

    const handleDragEnd = useCallback(
        ({ active, over }: DragEndEvent) => {
            if (state.status !== 'success' || !over) return;
            const applicationId = Number(active.id);
            const candidate = state.candidates.find((c) => c.applicationId === applicationId);
            const targetStep = state.steps.find((step) => step.id === Number(over.id));
            if (!candidate || !targetStep || candidate.currentInterviewStep === targetStep.name) return;

            const previousStepName = candidate.currentInterviewStep;
            const moveTo = (stepName: string) =>
                setState((current) =>
                    current.status === 'success'
                        ? {
                              ...current,
                              candidates: current.candidates.map((c) =>
                                  c.applicationId === applicationId ? { ...c, currentInterviewStep: stepName } : c
                              ),
                          }
                        : current
                );
            const setSaving = (saving: boolean) =>
                setSavingIds((current) => {
                    const next = new Set(current);
                    if (saving) {
                        next.add(applicationId);
                    } else {
                        next.delete(applicationId);
                    }
                    return next;
                });

            // Optimistic update: move the card immediately, roll it back if the backend rejects the change.
            setMoveError(null);
            moveTo(targetStep.name);
            setSaving(true);
            updateCandidateStage(candidate.id, applicationId, targetStep.id)
                .catch(() => {
                    moveTo(previousStepName);
                    setMoveError(
                        `No se ha podido mover a ${candidate.fullName} a la fase ${targetStep.name}. ` +
                            `Se ha devuelto a la fase ${previousStepName}.`
                    );
                })
                .finally(() => setSaving(false));
        },
        [state]
    );

    return (
        <main className="position-page" aria-busy={state.status === 'loading'}>
            <div className="position-header">
                <Link to="/positions" className="position-back" aria-label="Volver al listado de posiciones">
                    <svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true" focusable="false">
                        <path
                            fill="currentColor"
                            fillRule="evenodd"
                            d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"
                        />
                    </svg>
                </Link>
                <h1 className="position-title">
                    {positionName ?? <span className="position-title-placeholder">Cargando posición…</span>}
                </h1>
            </div>

            {state.status === 'loading' && (
                <p className="position-status" role="status">
                    Cargando proceso de selección…
                </p>
            )}

            {state.status === 'error' && (
                <p className="position-status position-status-error" role="alert">
                    {state.message}
                </p>
            )}

            {state.status === 'success' && (
                <>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={collisionDetection}
                        onDragEnd={handleDragEnd}
                        accessibility={{ announcements, screenReaderInstructions }}
                    >
                        <div className="stage-board">
                            {state.steps.map((step) => (
                                <StageColumn
                                    key={step.id}
                                    step={step}
                                    candidates={candidatesByStep.get(step.name) ?? []}
                                    savingIds={savingIds}
                                />
                            ))}
                        </div>
                    </DndContext>
                    {/* Fixed-position message so it never shifts the board (CLS). */}
                    <div role="alert" className="position-toast-region">
                        {moveError && (
                            <div className="position-toast">
                                <p>{moveError}</p>
                                <button type="button" onClick={() => setMoveError(null)}>
                                    Cerrar
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </main>
    );
};

export default PositionDetails;
