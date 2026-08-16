import { NhostProvider } from '@nhost/react'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import ApolloWrapper from '../lib/apollo'
import { nhost } from '../lib/nhost'
import { OrgProvider } from '../lib/org'
import '../styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <NhostProvider nhost={nhost}>
      <ApolloWrapper>
        <OrgProvider>
          <Head>
            <title>AgentFlow</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
          </Head>
          <Component {...pageProps} />
        </OrgProvider>
      </ApolloWrapper>
    </NhostProvider>
  )
}
