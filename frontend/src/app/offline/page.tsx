"use client";
export default function Offline() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "20px",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</h1>
      <h2 style={{ fontSize: "2rem", marginBottom: "1rem" }}>You re Offline</h2>
      <p style={{ color: "#666", maxWidth: "400px", marginBottom: "2rem" }}>
        It looks like you ve lost your internet connection. Please check your
        network and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "12px 24px",
          fontSize: "1rem",
          backgroundColor: "#0070f3",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
