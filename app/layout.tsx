import "./globals.css";
export const metadata = {
  title: "Vultrix Voice · Private control room",
  description: "Private, owner-authorized voice and call operations.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
