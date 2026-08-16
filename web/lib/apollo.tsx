import {
  ApolloClient,
  ApolloProvider,
  HttpLink,
  InMemoryCache,
  from,
  split,
} from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { getMainDefinition } from '@apollo/client/utilities'
import { useAuthenticationStatus, useUserId } from '@nhost/react'
import { createClient } from 'graphql-ws'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { graphqlHttpUrl, graphqlWsUrl, nhost } from './nhost'

function buildClient() {
  const authLink = setContext(async (_operation, { headers }) => {
    const token = nhost.auth.getAccessToken()
    return {
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }
  })

  const httpLink = from([authLink, new HttpLink({ uri: graphqlHttpUrl })])

  // During SSR there is no websocket; queries render client-side anyway.
  if (typeof window === 'undefined') {
    return new ApolloClient({ link: httpLink, cache: new InMemoryCache() })
  }

  const wsLink = new GraphQLWsLink(
    createClient({
      url: graphqlWsUrl,
      lazy: true,
      retryAttempts: 8,
      connectionParams: () => {
        const token = nhost.auth.getAccessToken()
        return { headers: token ? { authorization: `Bearer ${token}` } : {} }
      },
    })
  )

  const link = split(
    ({ query }) => {
      const def = getMainDefinition(query)
      return def.kind === 'OperationDefinition' && def.operation === 'subscription'
    },
    wsLink,
    httpLink
  )

  return new ApolloClient({ link, cache: new InMemoryCache() })
}

export default function ApolloWrapper({ children }: { children: ReactNode }) {
  // Rebuild the client whenever the session changes so the websocket
  // reconnects with a fresh token and no cross-session cache survives.
  const { isAuthenticated } = useAuthenticationStatus()
  const userId = useUserId()
  const client = useMemo(() => buildClient(), [isAuthenticated, userId])
  return <ApolloProvider client={client}>{children}</ApolloProvider>
}
