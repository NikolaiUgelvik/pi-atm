import { Type } from "typebox"

export const compressionToolParameters = Type.Object({
  topic: Type.Optional(Type.String({ description: "Short label/topic for this compression." })),
  summary: Type.Optional(
    Type.String({ description: "High-fidelity technical summary for legacy single-range calls." }),
  ),
  content: Type.Optional(
    Type.Array(
      Type.Object({
        startId: Type.Optional(Type.String({ description: "Start message alias, e.g. m0001, for range mode." })),
        endId: Type.Optional(Type.String({ description: "End message alias, e.g. m0010, for range mode." })),
        messageId: Type.Optional(
          Type.String({
            description: "Message alias, e.g. m0001, or compression block alias, e.g. b1, for message mode.",
          }),
        ),
        topic: Type.Optional(Type.String()),
        summary: Type.String(),
      }),
    ),
  ),
  focus: Type.Optional(Type.String({ description: "What this compression focused on." })),
  mode: Type.Optional(Type.Union([Type.Literal("range"), Type.Literal("message")])),
  target: Type.Optional(
    Type.Union([Type.Literal("stale"), Type.Literal("since_last_user"), Type.Literal("all_except_recent")]),
  ),
  keepRecentMessages: Type.Optional(Type.Number({ description: "Number of recent messages to keep verbatim." })),
  startIndex: Type.Optional(Type.Number({ description: "Optional context message start index, inclusive." })),
  endIndex: Type.Optional(Type.Number({ description: "Optional context message end index, inclusive." })),
})
