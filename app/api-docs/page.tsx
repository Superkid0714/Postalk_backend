import type { Metadata } from "next";

import SwaggerDocs from "./swagger-ui";

export const metadata: Metadata = {
  title: "POSTALK API 문서",
  description: "POSTALK 프론트엔드 연동용 OpenAPI 문서",
};

export default function ApiDocsPage() {
  return <SwaggerDocs />;
}
